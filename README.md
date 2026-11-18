# cf_ai_chat_agent

AI chat agent built on Cloudflare (Cloudflare AI app assignment).

| Requirement | Implementation |
|---|---|
| LLM | Llama 3.3 70B on Workers AI (`@cf/meta/llama-3.3-70b-instruct-fp8-fast`) — `src/server.ts` |
| Workflow / coordination | `ChatAgent` Durable Object (Agents SDK) with tool calls + scheduled tasks |
| User input | React chat UI served as static assets (`src/app.tsx`) over WebSocket |
| Memory / state | Chat history persisted in the Durable Object's SQLite storage |

## Run locally

```bash
npm install
npx wrangler login   # Workers AI runs remotely, even in dev
npm run dev          # http://localhost:5173
```

## Deploy

```bash
npm run deploy
```

Prompt history used to build this is in [PROMPTS.md](PROMPTS.md).
