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

export const ERROR_RESPONSES = [
  {
    route: "POST /api/login",
    status: 401,
    body: "Wrong passcode",
    when: "wrong or missing passcode (passcode mode)"
  },
  {
    route: "POST /api/login",
    status: 429,
    body: "Too many attempts. Try again later.",
    when: "too many failed logins from one IP or overall"
  },
  {
    route: "POST /api/login",
    status: 405,
    body: "Method not allowed",
    when: "any method other than POST"
  },
  {
    route: "GET /api/session",
    status: 401,
    body: "(no body)",
    when: "no valid session cookie (passcode mode only)"
  },
  {
    route: "Any /agents/* request",
    status: 401,
    body: "Unauthorized",
    when: "no valid session in passcode mode"
  },
  {
    route: "Any other /api/* path",
    status: 404,
    body: "Not found",
    when: "unknown API path"
  },
  {
    route: "http:// request",
    status: 301,
    body: "redirect to https://",
    when: "any plain-HTTP request to a public host"
  },
  {
    route: "RPC sendMessage",
    status: null,
    body: "Message must be text.",
    when: "argument is not a string"
  },
  {
    route: "RPC sendMessage",
    status: null,
    body: "The team is still replying. Wait for them to finish.",
    when: "a run is already in progress"
  },
  {
    route: "RPC sendMessage",
    status: null,
    body: "Limit is 6 messages a minute.",
    when: "more than 6 messages in a minute"
  },
  {
    route: "RPC clearAll",
    status: null,
    body: "Wrong passcode.",
    when: "wrong admin passcode"
  }
] as const;

export const DECISIONS = [
  "One Durable Object per agent, so each agent's memory is private and separately capped",
  "Vectorize namespace per agent, so RAG searches only that agent's memories",
  "Relevance is decided with embeddings, so storing a memory costs no extra model call",
  "Routing uses a short Llama 3.3 call only when no one is tagged",
  "Hand-offs stop after 4 agent replies per human message, to protect the AI quota",
  "Public demo runs in open mode; clearing everything needs the admin passcode",
  "Session cookies are signed with a separate secret and expire after 7 days",
  "Room state is written only by the server, never by clients"
] as const;

export const SECURITY_CHECKS = [
  "Page and API responses carry CSP, HSTS, nosniff, X-Frame-Options DENY and Referrer-Policy",
  "Plain http:// is redirected to https://",
  "Agent WebSocket refuses clients without a valid session in passcode mode",
  "Clients cannot change room state (server-only writes)",
  "Non-text message input is rejected",
  "Failed logins are limited per IP and overall; a correct passcode is also blocked during lockout",
  "Clear-all is refused without the admin passcode",
  "Dependencies: no known critical or high advisories in the bundled runtime packages"
] as const;

export const RELEASE_STEPS = [
  "Run node --test test/ and npx tsc --noEmit",
  "Run npx oxlint src/ and check it reports no errors",
  "Run npm run deploy",
  "Check https://<worker>/api/session and the security headers respond",
  "Open the chat, send one tagged and one untagged message, and check replies arrive",
  "Confirm the GitHub Actions checks pass (Sanity Check, Semgrep)",
  "Update PROMPTS.md with any prompts from this change"
] as const;

export const TRIAGE_STEPS = [
  "Reproduce: write down the exact steps, input and environment",
  "Compare expected and actual behaviour, with the status code or message",
  "Check the server logs (Workers observability) for the request",
  "Find the smallest test that fails, and add it before fixing",
  "Decide severity: data loss or security is critical; wrong text is low",
  "Fix the root cause once, then rerun the test suite and the live flow tests"
] as const;

export const ACCESSIBILITY_CHECKS = [
  "Every input has a visible label (for example the passcode and admin passcode fields)",
  "Buttons have readable text or aria-labels (for example each agent's 'View memory' button)",
  'Error messages use role="alert" so screen readers announce them',
  "Colour is not the only signal: agent names and roles appear as text",
  "The chat input can be used with the keyboard; Enter sends, Shift+Enter adds a line"
] as const;

export function formatErrors(): string {
  return ERROR_RESPONSES.map(
    (e) =>
      `${e.route}${e.status ? ` (${e.status})` : ""}: "${e.body}" - ${e.when}`
  ).join("\n");
}
export function formatList(items: readonly string[]): string {
  return items.map((i, n) => `${n + 1}. ${i}`).join("\n");
}

export const LOG_STEPS = [
  "Live stream: run npx wrangler tail from the project folder and reproduce the request",
  "Dashboard: Cloudflare dashboard > Workers & Pages > cf-ai-chat-agent > Logs (observability is on)",
  "Failed logins are logged as 'Login failed' with the client IP; the passcode is never logged",
  "Empty model replies are logged as 'Empty reply, retrying' with the role and tool calls",
  "Unexpected failures in a team run are logged as 'Team run failed' with the error",
  "Logs show the request path and status; use them to match a user report to a time"
] as const;

export const PLANNING_STEPS = [
  "Write the user story: who needs it, what they can do, and why it matters",
  "List acceptance criteria as testable statements (what 'done' looks like)",
  "Note what it must not do (scope limits) and what is deferred",
  "Identify the parts it touches: UI screens, room messages, memory, configuration",
  "Check the roadmap and decisions first, so the plan fits existing choices",
  "Split the work into small steps, each with a test, in the order they can be shipped",
  "Name the risks: AI quota use, data loss, security, and what could break for visitors"
] as const;

export function readLogsGuide(): string {
  return formatList(LOG_STEPS);
}

export const PR_REVIEW_STEPS = [
  "Read the description: what problem does this solve, and is the scope clear?",
  "Run the automatic checks on the diff (secrets, debug logs, unsafe code, missing tests)",
  "Check the change is the smallest that works; flag unrelated edits",
  "Check error handling at trust boundaries: input validation, auth and data writes",
  "Check each new branch of logic has a test that would fail without it",
  "Check security: no secrets, no raw HTML, no unvalidated input reaching the model or storage",
  "Check the docs (README, PROMPTS) match the behaviour",
  "Give a verdict: approve, approve with small changes, or request changes, with the reasons"
] as const;
