import { DurableObject } from "cloudflare:workers";
import { Agent, callable, getAgentByName, routeAgentRequest } from "agents";
import {
  checkPasscode,
  clearedCookie,
  createSession,
  isAuthorized,
  loginBlocked,
  sessionCookie
} from "./auth";
import { httpsRedirectUrl, isLocalHost, withSecurityHeaders } from "./http";
import {
  ROADMAP,
  UI_FLOWS,
  formatDeployConfig,
  formatEndpoints,
  formatTestSuites
} from "./project-facts";
import { generateText, stepCountIs, tool, type ToolSet } from "ai";
import { createWorkersAI } from "workers-ai-provider";
import { z } from "zod";
import {
  HUMAN_ID,
  MAX_AGENT_REPLIES,
  MESSAGES_PER_MINUTE,
  RAG_TOP_K,
  RECENT_MEMORIES,
  ROLES,
  cosine,
  evictionCount,
  extractText,
  handoffTargets,
  messageRejection,
  parseMentions,
  parseRoute,
  roleById,
  shouldRemember,
  stripSpeakerPrefix,
  type Role,
  type RoleId
} from "./team";

const CHAT_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
const EMBED_MODEL = "@cf/baai/bge-small-en-v1.5";
const VISIBLE_MESSAGES = 100;

export interface ChatMessage {
  id: string;
  author: string; // RoleId or HUMAN_ID
  text: string;
  createdAt: number;
}

export interface Memory {
  id: string;
  author: string;
  text: string;
  createdAt: number;
}

export interface RoomState {
  messages: ChatMessage[];
  memoryCounts: Record<string, number>;
  working: RoleId[];
}

/** What the room tells every agent about a new message. */
export interface Observation {
  message: ChatMessage;
  embedding: number[];
  relevance: number;
  bestRelevance: number;
  mentioned: boolean;
  assigned: boolean;
}

async function embed(env: Env, texts: string[]): Promise<number[][]> {
  const out = (await env.AI.run(EMBED_MODEL, { text: texts })) as {
    data: number[][];
  };
  return out.data;
}

function authorLabel(author: string): string {
  const role = roleById(author);
  return role ? `${role.name} (@${role.id}, ${role.title})` : "the human";
}

/** Read-only tools per role. They return fixed project facts and reach nothing outside the app. */
function roleTools(id: RoleId): ToolSet {
  const give = (name: string, description: string, output: () => string) => ({
    [name]: tool({
      description,
      inputSchema: z.object({}),
      execute: async () => output()
    })
  });
  const byRole: Record<RoleId, ToolSet> = {
    lead: give(
      "get_roadmap",
      "List the planned next features for this project.",
      () => ROADMAP.join("\n")
    ),
    backend: give(
      "list_api_endpoints",
      "List the real HTTP and RPC endpoints of this app.",
      formatEndpoints
    ),
    frontend: give(
      "list_ui_flows",
      "List the screens and actions in the chat UI.",
      () => UI_FLOWS.join("\n")
    ),
    qa: give(
      "list_test_suites",
      "List the automated test files and what they cover.",
      formatTestSuites
    ),
    devops: give(
      "get_deploy_config",
      "Show the deployment setup: bindings, models, limits and access mode.",
      formatDeployConfig
    )
  };
  return byRole[id];
}

/**
 * One AI teammate. Each instance (named by role id) is its own Durable Object
 * with its own SQLite memory and its own Vectorize namespace. It never reads
 * the room transcript, only what it chose to remember.
 */
export class TeamMember extends Agent<Env> {
  onStart() {
    this.sql`CREATE TABLE IF NOT EXISTS memories (
      id TEXT PRIMARY KEY, author TEXT NOT NULL, text TEXT NOT NULL, created_at INTEGER NOT NULL
    )`;
  }

  private get role(): Role {
    const role = roleById(this.name);
    if (!role) throw new Error(`Unknown team member: ${this.name}`);
    return role;
  }

  private vectorId(messageId: string) {
    return `${this.name}:${messageId}`;
  }

  private memoryCount(): number {
    return this.sql<{ n: number }>`SELECT COUNT(*) AS n FROM memories`[0].n;
  }

  /** Sees a new room message and decides whether to keep it. Returns the memory count. */
  async observe(o: Observation): Promise<number> {
    const keep = shouldRemember({
      relevance: o.relevance,
      bestRelevance: o.bestRelevance,
      mentioned: o.mentioned,
      assigned: o.assigned,
      isAuthor: o.message.author === this.name
    });
    if (!keep) return this.memoryCount();

    const m = o.message;
    this.sql`INSERT OR IGNORE INTO memories (id, author, text, created_at)
      VALUES (${m.id}, ${m.author}, ${m.text}, ${m.createdAt})`;
    await this.env.MEMORY_INDEX.upsert([
      {
        id: this.vectorId(m.id),
        values: o.embedding,
        namespace: this.name
      }
    ]);

    const evict = evictionCount(this.memoryCount());
    if (evict > 0) {
      const old = this.sql<{ id: string }>`
        SELECT id FROM memories ORDER BY created_at ASC LIMIT ${evict}`;
      for (const { id } of old) this.sql`DELETE FROM memories WHERE id = ${id}`;
      await this.env.MEMORY_INDEX.deleteByIds(
        old.map(({ id }) => this.vectorId(id))
      );
    }
    return this.memoryCount();
  }

  /** RAG: the most similar memories plus the most recent few, oldest first. */
  private async recall(queryEmbedding: number[]): Promise<Memory[]> {
    const hits = await this.env.MEMORY_INDEX.query(queryEmbedding, {
      topK: RAG_TOP_K,
      namespace: this.name
    });
    const prefix = `${this.name}:`;
    const ids = new Set(hits.matches.map((h) => h.id.slice(prefix.length)));
    const recent = this.sql<{ id: string }>`
      SELECT id FROM memories ORDER BY created_at DESC LIMIT ${RECENT_MEMORIES}`;
    for (const { id } of recent) ids.add(id);

    // SQLite is the source of truth: evicted memories drop out even if their vector lingers.
    return this.listMemories().filter((m) => ids.has(m.id));
  }

  listMemories(): Memory[] {
    return this.sql<{
      id: string;
      author: string;
      text: string;
      created_at: number;
    }>`SELECT id, author, text, created_at FROM memories ORDER BY created_at ASC`.map(
      (r) => ({
        id: r.id,
        author: r.author,
        text: r.text,
        createdAt: r.created_at
      })
    );
  }

  /** Writes this agent's reply to a message, using only its own memory. */
  async respond(message: ChatMessage, embedding: number[]): Promise<string> {
    const role = this.role;
    const memories = await this.recall(embedding);
    const teammates = ROLES.filter((r) => r.id !== role.id)
      .map((r) => `@${r.id} (${r.name}, ${r.title}): ${r.focus}`)
      .join("\n");
    const memoryText = memories.length
      ? memories
          .filter((m) => m.id !== message.id)
          .map((m) => `- ${authorLabel(m.author)}: ${m.text}`)
          .join("\n")
      : "(nothing yet)";

    const tools = roleTools(role.id);
    const toolList = Object.entries(tools)
      .map(([name, t]) => `- ${name}: ${t.description}`)
      .join("\n");
    const system = `You are ${role.name}, the ${role.title} on an AI engineering team. You work in a shared group chat with a human teammate and these colleagues:
${teammates}

Your focus: ${role.focus}.
You cannot see the full chat. You only know the memories below, which you chose to keep.
Your tools (read-only facts about this project):
${toolList}
Rules:
- Answer as ${role.name} in under 120 words. Be concrete and practical.
- Use a tool when a question is about this project's facts. Do not guess endpoints, settings or tests.
- You have no access to shared drives, email, calendars, GitHub or deployments. Never say you saved, sent, deployed or checked anything outside this chat.
- If a specific part needs a colleague, tag them as @id and say exactly what you need. Tag at most one colleague, and only when they must act.
- Never tag yourself. Do not start with your name.`;

    const user = `Your memories:
${memoryText}

New message from ${authorLabel(message.author)}:
${message.text}`;

    const { text } = await generateText({
      model: createWorkersAI({ binding: this.env.AI })(CHAT_MODEL),
      system,
      prompt: user,
      tools,
      stopWhen: stepCountIs(3),
      maxOutputTokens: 400
    });
    return (
      stripSpeakerPrefix(text.trim(), role) || "(I couldn't produce a reply.)"
    );
  }

  async reset(): Promise<void> {
    const ids = this.listMemories().map((m) => this.vectorId(m.id));
    if (ids.length) await this.env.MEMORY_INDEX.deleteByIds(ids);
    this.sql`DELETE FROM memories`;
  }
}

/**
 * The shared chat room. Stores the transcript for the human's view, broadcasts
 * every message to all agents, routes work to the responsible agent and
 * follows @tags between agents up to MAX_AGENT_REPLIES per human message.
 */
export class TeamRoom extends Agent<Env, RoomState> {
  initialState: RoomState = { messages: [], memoryCounts: {}, working: [] };
  private roleEmbeddings?: Promise<number[][]>;
  private running = false;
  private recentSentAt: number[] = [];

  /** Only the server may change room state; clients get it read-only. */
  validateStateChange(_next: RoomState, source: unknown) {
    if (source !== "server") throw new Error("Room state is read-only");
  }

  onStart() {
    this.sql`CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY, author TEXT NOT NULL, text TEXT NOT NULL, created_at INTEGER NOT NULL
    )`;
  }

  private member(id: RoleId) {
    return getAgentByName(this.env.TeamMember, id);
  }

  private append(author: string, text: string): ChatMessage {
    const message: ChatMessage = {
      id: crypto.randomUUID(),
      author,
      text,
      createdAt: Date.now()
    };
    this.sql`INSERT INTO messages (id, author, text, created_at)
      VALUES (${message.id}, ${author}, ${text}, ${message.createdAt})`;
    this.setState({
      ...this.state,
      messages: [...this.state.messages, message].slice(-VISIBLE_MESSAGES)
    });
    return message;
  }

  private setWorking(id: RoleId, on: boolean) {
    const working = this.state.working.filter((w) => w !== id);
    this.setState({ ...this.state, working: on ? [...working, id] : working });
  }

  @callable()
  async sendMessage(text: unknown): Promise<void> {
    if (typeof text !== "string") throw new Error("Message must be text.");
    const trimmed = text.trim().slice(0, 4000);
    if (!trimmed) return;
    const now = Date.now();
    const rejection = messageRejection(this.recentSentAt, now, this.running);
    if (rejection) throw new Error(rejection);
    // In-memory guard: resets if the room restarts, which also ends any run.
    this.running = true;
    this.recentSentAt = [...this.recentSentAt, now].slice(-MESSAGES_PER_MINUTE);
    const message = this.append(HUMAN_ID, trimmed);
    try {
      // Reply in the background so the UI isn't blocked on the model.
      await this.queue("handleHumanMessage", message);
    } catch (error) {
      this.running = false;
      throw error;
    }
  }

  async handleHumanMessage(message: ChatMessage): Promise<void> {
    const budget = { left: MAX_AGENT_REPLIES };
    try {
      await this.deliver(message, budget);
    } catch (error) {
      console.error("Team run failed", error);
      this.append(
        "lead",
        "Something went wrong while the team was replying. Please try again."
      );
    } finally {
      this.running = false;
    }
  }

  /** Who must act on a message: tagged agents, else the router's pick for human messages. */
  private async responders(
    message: ChatMessage,
    answering?: string
  ): Promise<RoleId[]> {
    const tagged = handoffTargets(message.text, message.author, answering);
    if (tagged.length || message.author !== HUMAN_ID) return tagged;

    const roster = ROLES.map((r) => `${r.id}: ${r.title} — ${r.focus}`).join(
      "\n"
    );
    const result = await this.env.AI.run(CHAT_MODEL, {
      messages: [
        {
          role: "system",
          content: `You route messages to one member of an engineering team. Team:\n${roster}\nAnswer with only the id of the single best member. Use lead for planning, broad or unclear requests.`
        },
        { role: "user", content: message.text }
      ],
      max_tokens: 10
    });
    return [parseRoute(extractText(result))];
  }

  /** Broadcasts a message to every agent's memory, then lets the responsible agents reply. */
  private async deliver(
    message: ChatMessage,
    budget: { left: number },
    answering?: string
  ): Promise<void> {
    this.roleEmbeddings ??= embed(
      this.env,
      ROLES.map((r) => `${r.title}: ${r.focus}`)
    );
    const [[embedding], roleVectors, responders] = await Promise.all([
      embed(this.env, [message.text]),
      this.roleEmbeddings,
      this.responders(message, answering)
    ]);
    const relevance = roleVectors.map((v) => cosine(embedding, v));
    const bestRelevance = Math.max(...relevance);
    const mentioned = parseMentions(message.text);

    const counts = await Promise.all(
      ROLES.map(async (role, i) =>
        (await this.member(role.id)).observe({
          message,
          embedding,
          relevance: relevance[i],
          bestRelevance,
          mentioned: mentioned.includes(role.id),
          assigned: responders.includes(role.id)
        })
      )
    );
    this.setState({
      ...this.state,
      memoryCounts: Object.fromEntries(ROLES.map((r, i) => [r.id, counts[i]]))
    });

    for (const id of responders) {
      if (budget.left <= 0) return;
      budget.left--;
      this.setWorking(id, true);
      let text: string;
      try {
        text = await (await this.member(id)).respond(message, embedding);
      } finally {
        this.setWorking(id, false);
      }
      await this.deliver(this.append(id, text), budget, message.author);
    }
  }

  @callable()
  async getMemories(id: string): Promise<Memory[]> {
    const role = roleById(id);
    if (!role) return [];
    return (await this.member(role.id)).listMemories();
  }

  @callable()
  async clearAll(): Promise<void> {
    if (this.env.ACCESS_MODE === "open")
      throw new Error("Clearing memories is disabled on the public demo.");
    await Promise.all(
      ROLES.map(async (r) => (await this.member(r.id)).reset())
    );
    this.sql`DELETE FROM messages`;
    this.setState({ messages: [], memoryCounts: {}, working: [] });
  }
}

/** Counts failed logins per IP and globally; one instance guards the whole app. */
export class LoginGuard extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS failures (ip TEXT NOT NULL, ts INTEGER NOT NULL)"
    );
  }

  isBlocked(ip: string, nowMs: number): boolean {
    const sql = this.ctx.storage.sql;
    sql.exec("DELETE FROM failures WHERE ts < ?", nowMs - 3_600_000);
    const perIp = sql
      .exec<{ n: number }>(
        "SELECT COUNT(*) AS n FROM failures WHERE ip = ? AND ts >= ?",
        ip,
        nowMs - 60_000
      )
      .one().n;
    const global = sql
      .exec<{ n: number }>("SELECT COUNT(*) AS n FROM failures")
      .one().n;
    return loginBlocked(perIp, global);
  }

  recordFailure(ip: string, nowMs: number): void {
    this.ctx.storage.sql.exec(
      "INSERT INTO failures (ip, ts) VALUES (?, ?)",
      ip,
      nowMs
    );
  }
}

async function handle(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const { pathname } = url;
  const secrets = {
    passcode: env.TEAM_PASSCODE,
    sessionSecret: env.SESSION_SECRET
  };
  const now = Date.now();

  if (pathname === "/api/login") {
    if (request.method !== "POST")
      return new Response("Method not allowed", { status: 405 });
    const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";
    const guard = env.LoginGuard.getByName("global");
    if (await guard.isBlocked(ip, now))
      return new Response("Too many attempts. Try again later.", {
        status: 429,
        headers: { "Retry-After": "60" }
      });
    const body = (await request.json().catch(() => ({}))) as {
      passcode?: unknown;
    };
    if (
      !secrets.passcode ||
      !secrets.sessionSecret ||
      !(await checkPasscode(body.passcode, secrets.passcode))
    ) {
      await guard.recordFailure(ip, now);
      console.warn("Login failed", { ip });
      return new Response("Wrong passcode", { status: 401 });
    }
    const token = await createSession(
      { passcode: secrets.passcode, sessionSecret: secrets.sessionSecret },
      now
    );
    return new Response(null, {
      status: 204,
      headers: { "Set-Cookie": sessionCookie(token) }
    });
  }

  if (pathname === "/api/logout")
    return new Response(null, {
      status: 204,
      headers: { "Set-Cookie": clearedCookie() }
    });

  if (pathname === "/api/session" || pathname.startsWith("/agents/")) {
    // ACCESS_MODE=open: public demo, no passcode. Anything else requires a session.
    const open = env.ACCESS_MODE === "open";
    const authorized = open || (await isAuthorized(request, secrets, now));
    if (pathname === "/api/session")
      return new Response(null, { status: authorized ? 204 : 401 });
    if (!authorized) return new Response("Unauthorized", { status: 401 });
    return (
      (await routeAgentRequest(request, env)) ||
      new Response("Not found", { status: 404 })
    );
  }

  if (pathname.startsWith("/api/"))
    return new Response("Not found", { status: 404 });
  return env.ASSETS.fetch(request);
}

export default {
  async fetch(request: Request, env: Env) {
    const url = new URL(request.url);
    const redirect = httpsRedirectUrl(url);
    if (redirect) return Response.redirect(redirect, 301);
    return withSecurityHeaders(
      await handle(request, env),
      isLocalHost(url.hostname)
    );
  }
} satisfies ExportedHandler<Env>;
