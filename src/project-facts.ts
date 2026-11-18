// Read-only facts about this project, given to agents as tools. Plain data:
// no secrets, no network calls, no Cloudflare imports (so tests can run in node).

export const API_ENDPOINTS = [
  {
    method: "GET",
    path: "/api/session",
    purpose: "204 if the caller may use the team, else 401"
  },
  {
    method: "POST",
    path: "/api/login",
    purpose:
      "Passcode login (only in passcode mode); sets a signed session cookie"
  },
  { method: "POST", path: "/api/logout", purpose: "Clears the session cookie" },
  {
    method: "GET",
    path: "/agents/team-room/main",
    purpose: "WebSocket to the shared team room (chat state and RPC)"
  },
  {
    method: "RPC",
    path: "sendMessage(text)",
    purpose: "Post a human message; limited to 6 a minute and one run at a time"
  },
  {
    method: "RPC",
    path: "getMemories(roleId)",
    purpose: "List one agent's memories (max 50)"
  },
  {
    method: "RPC",
    path: "clearAll()",
    purpose: "Wipe chat and memories; refused in open mode"
  }
] as const;

export const DEPLOY_CONFIG = {
  worker: "cf-ai-chat-agent (Cloudflare Workers, TypeScript)",
  chatModel:
    "Llama 3.3 70B on Workers AI (@cf/meta/llama-3.3-70b-instruct-fp8-fast)",
  embeddingModel: "bge-small-en-v1.5 on Workers AI (384 dimensions)",
  vectorIndex:
    "Vectorize index 'team-memory', cosine similarity, one namespace per agent",
  durableObjects: [
    "TeamRoom (shared chat)",
    "TeamMember x5 (one per agent, SQLite memory)",
    "LoginGuard (failed-login counter)"
  ],
  accessMode: "open (public demo, no login); 'passcode' requires TEAM_PASSCODE",
  observability: "enabled",
  staticAssets:
    "public/ served by the Worker; HTTPS redirect and security headers on every response",
  limits:
    "4 agent replies per human message; 6 human messages a minute per room; memory cap 50 per agent"
} as const;

export const TEST_SUITES = [
  {
    file: "test/team.test.mjs",
    covers:
      "mentions, hand-offs, memory decision, memory cap, routing parse, message rate limit"
  },
  {
    file: "test/auth.test.mjs",
    covers:
      "passcode check, signed sessions, expiry, tampering, cookie flags, login limits"
  },
  {
    file: "test/http.test.mjs",
    covers: "HTTPS redirect, security headers, WebSocket pass-through"
  }
] as const;

export const UI_FLOWS = [
  "Passcode screen (only in passcode mode)",
  "Team chat: message list, live 'is typing' indicators, send box, @tag buttons",
  "Roster: one card per agent with its title and memory count",
  "Memory viewer: click an agent to see exactly what it remembers",
  "Clear chat and all memories (disabled on the public demo)",
  "Log out (passcode mode)"
] as const;

export const ROADMAP = [
  "Discord or Slack alerts when an agent tags you",
  "Daily email digest of team activity via Cloudflare Email Routing",
  "Per-role tools with human approval (GitHub for Backend, Wrangler for DevOps)",
  "Multiple rooms and per-user accounts",
  "Connect to a real GitHub repository for the PR agent"
] as const;

export function formatEndpoints(): string {
  return API_ENDPOINTS.map((e) => `${e.method} ${e.path} - ${e.purpose}`).join(
    "\n"
  );
}

export function formatDeployConfig(): string {
  return Object.entries(DEPLOY_CONFIG)
    .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join("; ") : v}`)
    .join("\n");
}

export function formatTestSuites(): string {
  return TEST_SUITES.map((t) => `${t.file} - ${t.covers}`).join("\n");
}
