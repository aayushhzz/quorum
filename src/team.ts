// Pure team logic shared by the server and the UI. No Cloudflare imports, so
// it can be tested with `node --test`.

export type RoleId = "lead" | "backend" | "frontend" | "qa" | "devops";

export interface Role {
  id: RoleId;
  name: string;
  title: string;
  /** What the role cares about. Embedded once and used to judge relevance. */
  focus: string;
}

export const ROLES: readonly Role[] = [
  {
    id: "lead",
    name: "Lena",
    title: "Tech Lead",
    focus:
      "planning, priorities, scope, requirements, breaking work into tasks, deadlines, coordinating the team, technical decisions and trade-offs"
  },
  {
    id: "backend",
    name: "Bao",
    title: "Backend Engineer",
    focus:
      "APIs, endpoints, databases, SQL, data models, server code, Cloudflare Workers, Durable Objects, authentication, performance"
  },
  {
    id: "frontend",
    name: "Fern",
    title: "Frontend Engineer",
    focus:
      "user interface, React components, CSS, layout, accessibility, user experience, browser behaviour, forms, design"
  },
  {
    id: "qa",
    name: "Quinn",
    title: "QA Engineer",
    focus:
      "testing, test cases, bugs, edge cases, regressions, reproduction steps, acceptance criteria, quality"
  },
  {
    id: "devops",
    name: "Dev",
    title: "DevOps Engineer",
    focus:
      "deployment, CI/CD pipelines, infrastructure, environments, secrets, monitoring, logs, alerts, incidents, wrangler"
  }
];

export const HUMAN_ID = "human";
/** Agent replies allowed per human message, across all hand-offs. */
export const MAX_AGENT_REPLIES = 4;
/** Memories each agent keeps; the oldest are evicted beyond this. */
export const MEMORY_CAP = 50;
/** Memories retrieved by vector search for each reply. */
export const RAG_TOP_K = 5;
/** Most recent memories always included, since new vectors take a moment to become searchable. */
export const RECENT_MEMORIES = 3;
/** An agent remembers a message if its relevance is within this of the most relevant role's. */
export const RELEVANCE_MARGIN = 0.03;

/** Human messages a room accepts per minute; each one can cost ~10 model calls. */
export const MESSAGES_PER_MINUTE = 6;

/** Why a new human message must wait, or null if it can be sent now. */
export function messageRejection(
  recentSentAt: readonly number[],
  nowMs: number,
  running: boolean
): string | null {
  if (running) return "The team is still replying. Wait for them to finish.";
  const lastMinute = recentSentAt.filter((t) => nowMs - t < 60_000).length;
  if (lastMinute >= MESSAGES_PER_MINUTE)
    return `Limit is ${MESSAGES_PER_MINUTE} messages a minute. Try again shortly.`;
  return null;
}

const ROLE_IDS = new Set<string>(ROLES.map((r) => r.id));

export function isRoleId(id: string): id is RoleId {
  return ROLE_IDS.has(id);
}

export function roleById(id: string): Role | undefined {
  return ROLES.find((r) => r.id === id);
}

/** Role ids tagged as `@id` or `@Name`, in order of first mention, without duplicates. */
export function parseMentions(text: string): RoleId[] {
  const found: RoleId[] = [];
  for (const match of text.matchAll(/@([a-z]+)\b/gi)) {
    const tag = match[1].toLowerCase();
    const role = ROLES.find(
      (r) => r.id === tag || r.name.toLowerCase() === tag
    );
    if (role && !found.includes(role.id)) found.push(role.id);
  }
  return found;
}

/**
 * Agents tagged in a message who must act on it. Never the author, and never the
 * agent being answered (it gets the reply in memory), which stops A↔B ping-pong.
 */
export function handoffTargets(
  text: string,
  author: string,
  answering?: string
): RoleId[] {
  return parseMentions(text).filter((id) => id !== author && id !== answering);
}

export function cosine(a: readonly number[], b: readonly number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

export interface RememberInput {
  relevance: number;
  bestRelevance: number;
  mentioned: boolean;
  isAuthor: boolean;
  assigned: boolean;
}

/** An agent's decision to store a message in its own memory. */
export function shouldRemember(i: RememberInput): boolean {
  return (
    i.isAuthor ||
    i.mentioned ||
    i.assigned ||
    i.relevance >= i.bestRelevance - RELEVANCE_MARGIN
  );
}

/** How many of the oldest memories to evict to get back under the cap. */
export function evictionCount(count: number, cap: number = MEMORY_CAP): number {
  return Math.max(0, count - cap);
}

/** First valid role id in the router model's answer, or the fallback. */
export function parseRoute(answer: string, fallback: RoleId = "lead"): RoleId {
  for (const word of answer.toLowerCase().match(/[a-z]+/g) ?? []) {
    if (isRoleId(word)) return word;
  }
  return fallback;
}

/** Text from a Workers AI chat result, which comes in native or OpenAI-style shape. */
export function extractText(result: unknown): string {
  const r = result as {
    response?: unknown;
    choices?: { message?: { content?: unknown } }[];
  };
  const text =
    typeof r?.response === "string"
      ? r.response
      : r?.choices?.[0]?.message?.content;
  return typeof text === "string" ? text.trim() : "";
}

/** Drops a leading "Name:" or "**Name (Title):**" the model sometimes adds. */
export function stripSpeakerPrefix(text: string, role: Role): string {
  const prefix = new RegExp(
    `^\\**\\s*(${role.name}|${role.title})[^:\\n]{0,30}:\\**\\s*`,
    "i"
  );
  return text.replace(prefix, "").trim();
}
