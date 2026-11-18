# cf_ai_chat_agent — AI Engineering Team

A multiplayer group chat where you work with a team of five AI agents on Cloudflare.
Send a message and the responsible agent picks it up; agents can `@tag` each other
to hand off work. Every agent keeps **its own capped memory** and answers using
**RAG over that memory only** — no agent reads the full transcript.

| Agent | Tag | Role |
|---|---|---|
| Lena | `@lead` | Tech Lead — planning, scope, coordination (default for broad requests) |
| Bao | `@backend` | Backend Engineer — APIs, data, Workers, Durable Objects |
| Fern | `@frontend` | Frontend Engineer — UI, React, accessibility |
| Quinn | `@qa` | QA Engineer — test cases, edge cases, bugs |
| Dev | `@devops` | DevOps Engineer — deploys, CI/CD, secrets, monitoring |

## Assignment components

| Requirement | Implementation |
|---|---|
| LLM | Llama 3.3 70B on Workers AI (`@cf/meta/llama-3.3-70b-instruct-fp8-fast`) for routing and replies; `@cf/baai/bge-small-en-v1.5` for embeddings |
| Workflow / coordination | `TeamRoom` Durable Object (Agents SDK) routes messages, fans them out to agents, follows `@tag` hand-offs with a reply budget; work runs in the background via the agent queue |
| User input | React chat UI (`src/app.tsx`) connected over WebSocket with `useAgent`; room state syncs live |
| Memory / state | Each `TeamMember` is its own Durable Object with SQLite memory (capped at 50) plus its own Vectorize namespace for RAG |

## How it works

```
You ──► TeamRoom (Durable Object)
          │ 1. store message, embed it once (bge-small)
          │ 2. who acts? @tags, else Llama 3.3 router picks one agent
          │ 3. broadcast to all 5 TeamMembers ─► each decides: remember or ignore
          │ 4. responsible agent: RAG over ITS memory ─► Llama 3.3 reply
          │ 5. reply re-enters step 1; @tags hand off (max 4 replies per message)
          ▼
        UI (live state over WebSocket)
```

- **Memory decision:** each agent compares the message embedding with its role focus.
  It keeps the message if it is among the most relevant roles, is tagged, is assigned
  the work, or wrote it (`shouldRemember` in `src/team.ts`).
- **Memory cap:** 50 per agent; the oldest are evicted from SQLite and Vectorize.
- **RAG:** top 5 vector matches from the agent's namespace plus its 3 most recent
  memories (new vectors take a moment to become searchable). SQLite is the source of
  truth, so evicted memories never come back.
- **Loop guard:** at most 4 agent replies per human message, and an agent answering a
  hand-off can't re-trigger the agent that handed off to it (no A↔B ping-pong).
- Click an agent in the sidebar to see exactly what it remembers.

## Run locally

```bash
npm install
npx wrangler login                                   # Workers AI + Vectorize run remotely, even in dev
npx wrangler vectorize create team-memory --dimensions=384 --metric=cosine   # once per account
npm run dev                                          # http://localhost:5173
```

Your account needs a workers.dev subdomain for remote bindings in dev
(Dashboard → Workers & Pages).

## Test

```bash
node --test test/     # pure team logic: mentions, hand-offs, memory decision, cap, routing
npx tsc --noEmit
```

## Deploy

```bash
npm run deploy
```

## Future improvements

- Push alerts to Discord/Slack via an incoming webhook when an agent tags you.
- Daily email digest of the team's activity via Cloudflare Email.
- Tools per role (e.g. GitHub for Backend, Wrangler for DevOps) with human approval.
- Multiple rooms/projects and per-user auth.

Prompt history used to build this is in [PROMPTS.md](PROMPTS.md).
