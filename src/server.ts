import { Agent, callable, getAgentByName, routeAgentRequest } from "agents";
import { authCookie, checkPasscode, isAuthorized } from "./auth";
import {
  HUMAN_ID,
  MAX_AGENT_REPLIES,
  RAG_TOP_K,
  RECENT_MEMORIES,
  ROLES,
  cosine,
  evictionCount,
  extractText,
  handoffTargets,
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

    const system = `You are ${role.name}, the ${role.title} on an AI engineering team. You work in a shared group chat with a human teammate and these colleagues:
${teammates}

Your focus: ${role.focus}.
You cannot see the full chat. You only know the memories below, which you chose to keep.
Rules:
- Answer as ${role.name} in under 120 words. Be concrete and practical.
- Do your own part of the work yourself.
- If a specific part needs a colleague, tag them as @id and say exactly what you need. Tag at most one colleague, and only when they must act.
- Never tag yourself. Do not start with your name.`;

    const user = `Your memories:
${memoryText}

New message from ${authorLabel(message.author)}:
${message.text}`;

    const result = await this.env.AI.run(CHAT_MODEL, {
      messages: [
        { role: "system", content: system },
        { role: "user", content: user }
      ],
      max_tokens: 400
    });
    return (
      stripSpeakerPrefix(extractText(result), role) ||
      "(I couldn't produce a reply.)"
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
  async sendMessage(text: string): Promise<void> {
    const trimmed = text.trim().slice(0, 4000);
    if (!trimmed) return;
    const message = this.append(HUMAN_ID, trimmed);
    // Reply in the background so the UI isn't blocked on the model.
    await this.queue("handleHumanMessage", message);
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
      memoryCounts: Object.fromEntries(
        ROLES.map((r, i) => [r.id, counts[i]])
      )
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
    await Promise.all(ROLES.map(async (r) => (await this.member(r.id)).reset()));
    this.sql`DELETE FROM messages`;
    this.setState({ messages: [], memoryCounts: {}, working: [] });
  }
}

export default {
  async fetch(request: Request, env: Env) {
    const { pathname } = new URL(request.url);
    const passcode = env.TEAM_PASSCODE;

    if (pathname === "/api/login" && request.method === "POST") {
      const body = (await request.json().catch(() => ({}))) as {
        passcode?: unknown;
      };
      if (!(await checkPasscode(body.passcode, passcode)))
        return new Response("Wrong passcode", { status: 401 });
      return new Response(null, {
        status: 204,
        headers: { "Set-Cookie": await authCookie(passcode) }
      });
    }

    const authorized = await isAuthorized(request, passcode);
    if (pathname === "/api/session")
      return new Response(null, { status: authorized ? 204 : 401 });
    if (!authorized) return new Response("Unauthorized", { status: 401 });

    return (
      (await routeAgentRequest(request, env)) ||
      new Response("Not found", { status: 404 })
    );
  }
} satisfies ExportedHandler<Env>;
