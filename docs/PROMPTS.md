# Prompt history

AI-assisted coding was used for this project (Claude Code). These are the prompts I gave,
in order, with a short note on what each one produced.

- **Edited for relevance:** prompts unrelated to building this app (personal notes,
  abandoned side ideas, short confirmations) are left out.
- **Sanitized:** secrets are replaced with `[REDACTED]`. Prompts are otherwise verbatim,
  typos included.

---

### 1. Understand the assignment and set up the environment

> *(pasted the Cloudflare assignment text: build an AI-powered app on Cloudflare with an
> LLM, workflow/coordination, chat or voice input, and memory/state; submit prompt history)*
>
> what is the requirement of this plan this and setup the environment for this

**Result:** Explained the four required parts. Scaffolded the project from
`cloudflare/agents-starter` in a `cf_ai_`-prefixed folder, switched the model to
Llama 3.3 on Workers AI, added README and PROMPTS, and ran `git init`.

### 2. Install Cloudflare tooling for the coding agent

> Fetch and execute the appropriate instructions to set me up for Cloudflare from https://developers.cloudflare.com/agent-setup/prompt.md

**Result:** Installed the official Cloudflare skills and MCP plugin for Claude Code.

### 3. Get local development working

> Subdomain registered

*(after registering a workers.dev subdomain, which remote bindings need in local dev)*

**Result:** Debugged local dev:
- Upgraded Wrangler and the Vite plugin, because the old remote AI proxy returned internal errors.
- Found that Workers AI streams each delta twice, which doubled the text and broke tool-call
  JSON. Added a workaround and verified tool calls and memory in the browser.

### 4. Decide what to build

> https://developers.cloudflare.com/agents/
> https://agents.cloudflare.com
> npm i agents
>
> these are the links they have mentioned also build something useful from this that can be used by us also in our daily life and development work

**Result:** Reviewed what the Agents SDK makes easy (scheduling, per-agent state, tools,
workflows) and narrowed the idea down.

### 5. Define the product: a multiplayer AI engineering team

> create a multiplayter chat in which all the agents are added then when i send message in that chat the agent responsible for the work picks up tha work and then replies also other agents can read write and tag other agents this should be an AI agent engineering team and also a human that is me

### 6. Memory design: separate capped memories with RAG

> just pick sensible roles and start building
> also this is just a idea that i need to build and submit in the cloudflare job listing as they have asked it so models and accurateness should not be the concern oiur concern shold be that we can build this accurately also the reading of messages can be avoided by having seperate memory each for each agent when a message comes every agent reads it and thn decides if it needs to add that in memory or not is it relevent to it or not and then each agent reads only the memory each time and also there should be a upper limit on the memory size also try top implement RAG for all these agent memories

**Result:** Built the app:
- **Agents:** a `TeamRoom` Durable Object coordinates the chat, and five `TeamMember`
  Durable Objects (Lead, Backend, Frontend, QA, DevOps) each have their own SQLite memory
  (capped at 50) and their own Vectorize namespace for RAG.
- **Routing:** Llama 3.3 picks which agent should respond, and agents hand off work with
  `@tags`, limited to 4 replies per message with a guard against back-and-forth loops.
- **UI:** a chat page with a memory viewer for each agent.
- **Tests:** unit tests for the core logic.

### 7. Ship it

> deploy it and commit the changes

**Result:** Committed and deployed to workers.dev, then checked a live handoff between agents.

### 8. Protect the deployment

> Add a passcode

> [REDACTED] should be the passcode

**Result:** Added a shared-passcode gate:
- **Login:** `/api/login` sets an HttpOnly, Secure, SameSite=Strict cookie.
- **Protected routes:** `/agents/*` and the WebSocket require that cookie.
- **Storage:** the passcode is a Wrangler secret in production and lives in a gitignored
  `.dev.vars` file locally.

### 9. Security audit

> *(pasted an OWASP Top 10:2025 checklist covering access control, misconfiguration,
> supply chain, cryptography, injection, insecure design, authentication, integrity,
> logging and exception handling)*
>
> Perform a security audit of this web application against the OWASP Top 10:2025. … Do NOT modify any code. Report only. Only test against my own site/staging.

**Result:** A report-only audit with non-destructive tests against my own deployment.
It found 14 issues (1 High, 6 Medium, 7 Low) and listed the checks that passed.

### 10. Fix the audit findings

> Fix High + Medium

**Result:**
- **Brute force:** login rate limiting with a `LoginGuard` Durable Object.
- **Sessions:** signed, expiring session cookies with a separate secret, plus logout.
- **State:** room state can only be changed by the server.
- **Cost:** a limit of one run at a time and 6 messages per minute.
- **HTTP:** an HTTPS redirect and security headers (CSP, HSTS and more) on every response.
- **Dependencies:** patched the vulnerable packages bundled into the Worker.

Verified with 24 live checks.

### 11. Prepare this file

> Now make the prompts.md file and clean up any prompts that are not related to the development, and also sanitize the prompt history so that we don't expose any secrets.
