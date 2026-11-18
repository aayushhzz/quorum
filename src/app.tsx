import { useEffect, useRef, useState, type ReactNode } from "react";
import { useAgent } from "agents/react";
import type { Memory, RoomState, TeamRoom } from "./server";
import {
  HUMAN_ID,
  MEMORY_CAP,
  ROLES,
  roleById,
  type Role,
  type RoleId
} from "./team";

const COLORS: Record<RoleId, string> = {
  lead: "bg-violet-600",
  backend: "bg-sky-600",
  frontend: "bg-pink-600",
  qa: "bg-amber-600",
  devops: "bg-emerald-600"
};

const SUGGESTIONS = [
  "We need a signup page with email verification. Plan it.",
  "@backend design the users table and the POST /signup endpoint",
  "@qa what edge cases should we test for login?"
];

function Avatar({ role }: { role?: Role }) {
  return (
    <div
      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-semibold text-white ${
        role ? COLORS[role.id] : "bg-gray-500"
      }`}
      aria-hidden
    >
      {role ? role.name[0] : "Y"}
    </div>
  );
}

/** Highlights @tags that name a teammate. */
function withMentions(text: string): ReactNode[] {
  return text.split(/(@[a-z]+)\b/gi).map((part, i) => {
    const tag = part.startsWith("@") ? part.slice(1).toLowerCase() : "";
    const role = ROLES.find(
      (r) => r.id === tag || r.name.toLowerCase() === tag
    );
    return role ? (
      <span
        key={i}
        className={`rounded px-1 font-medium text-white ${COLORS[role.id]}`}
      >
        @{role.name}
      </span>
    ) : (
      part
    );
  });
}

/** Shows the passcode screen until the server accepts the session cookie. */
export default function App() {
  const [status, setStatus] = useState<"checking" | "locked" | "open">(
    "checking"
  );
  const [passcode, setPasscode] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/session").then((r) => setStatus(r.ok ? "open" : "locked"));
  }, []);

  if (status === "open") return <TeamChat />;
  if (status === "checking") return null;

  return (
    <div className="flex h-full items-center justify-center p-4">
      <form
        className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-sm dark:bg-gray-900"
        onSubmit={async (e) => {
          e.preventDefault();
          setError("");
          const r = await fetch("/api/login", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ passcode })
          });
          if (r.ok) setStatus("open");
          else setError("Wrong passcode. Try again.");
        }}
      >
        <h1 className="mb-1 text-lg font-semibold">AI Engineering Team</h1>
        <p className="mb-4 text-sm text-gray-500">
          Enter the team passcode to join the chat.
        </p>
        <label htmlFor="passcode" className="mb-1 block text-sm font-medium">
          Passcode
        </label>
        <input
          id="passcode"
          type="password"
          autoComplete="current-password"
          value={passcode}
          onChange={(e) => setPasscode(e.target.value)}
          className="mb-2 w-full rounded-lg border border-gray-300 bg-transparent p-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 dark:border-gray-700"
        />
        {error && (
          <p role="alert" className="mb-2 text-sm text-red-600">
            {error}
          </p>
        )}
        <button
          type="submit"
          disabled={!passcode}
          className="w-full rounded-lg bg-violet-600 py-2 text-sm font-medium text-white disabled:opacity-40"
        >
          Join
        </button>
      </form>
    </div>
  );
}

function TeamChat() {
  const [state, setState] = useState<RoomState>({
    messages: [],
    memoryCounts: {},
    working: []
  });
  const agent = useAgent<TeamRoom, RoomState>({
    agent: "team-room",
    name: "main",
    onStateUpdate: setState
  });
  const [draft, setDraft] = useState("");
  const [viewing, setViewing] = useState<Role | null>(null);
  const [memories, setMemories] = useState<Memory[] | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [state.messages.length, state.working.length]);

  // Refresh the open memory panel whenever counts change.
  useEffect(() => {
    if (!viewing) return;
    agent.call("getMemories", [viewing.id]).then(setMemories);
  }, [viewing, state.memoryCounts]);

  const send = (text = draft) => {
    if (!text.trim()) return;
    agent.call("sendMessage", [text]);
    setDraft("");
  };

  const tag = (role: Role) => {
    setDraft((d) => `${d}${d && !d.endsWith(" ") ? " " : ""}@${role.id} `);
    inputRef.current?.focus();
  };

  const connected = agent.identified;

  return (
    <div className="flex h-full flex-col md:flex-row">
      <aside className="border-b border-gray-200 bg-white p-4 md:w-72 md:border-r md:border-b-0 dark:border-gray-800 dark:bg-gray-900">
        <h1 className="text-lg font-semibold">AI Engineering Team</h1>
        <p className="mb-4 text-xs text-gray-500">
          {connected ? "● Connected" : "○ Connecting…"} · each agent keeps its
          own memory (max {MEMORY_CAP})
        </p>
        <ul className="flex gap-2 overflow-x-auto md:flex-col">
          {ROLES.map((role) => {
            const busy = state.working.includes(role.id);
            return (
              <li key={role.id} className="shrink-0">
                <button
                  type="button"
                  onClick={() => {
                    setMemories(null);
                    setViewing(role);
                  }}
                  className={`flex w-full items-center gap-3 rounded-lg p-2 text-left hover:bg-gray-100 dark:hover:bg-gray-800 ${
                    viewing?.id === role.id ? "bg-gray-100 dark:bg-gray-800" : ""
                  }`}
                  aria-label={`View ${role.name}'s memory`}
                >
                  <Avatar role={role} />
                  <div className="min-w-0">
                    <div className="text-sm font-medium">
                      {role.name}{" "}
                      <span className="text-gray-500">@{role.id}</span>
                    </div>
                    <div className="text-xs text-gray-500">
                      {busy ? "typing…" : role.title} ·{" "}
                      {state.memoryCounts[role.id] ?? 0} memories
                    </div>
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
        <button
          type="button"
          onClick={() => {
            if (confirm("Clear the chat and every agent's memory?")) {
              agent.call("clearAll");
              setMemories([]);
            }
          }}
          className="mt-4 hidden text-xs text-red-600 hover:underline md:block"
        >
          Clear chat and all memories
        </button>
      </aside>

      <main className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="flex-1 space-y-4 overflow-y-auto p-4">
          {state.messages.length === 0 && (
            <div className="mx-auto mt-10 max-w-md text-center text-sm text-gray-500">
              <p className="mb-3">
                Message the team. The right agent picks it up, and agents can
                @tag each other to hand off work.
              </p>
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => send(s)}
                  className="m-1 rounded-full border border-gray-300 px-3 py-1 text-xs hover:bg-gray-100 dark:border-gray-700 dark:hover:bg-gray-800"
                >
                  {s}
                </button>
              ))}
            </div>
          )}
          {state.messages.map((m) => {
            const role = roleById(m.author);
            const mine = m.author === HUMAN_ID;
            return (
              <div
                key={m.id}
                className={`flex gap-2 ${mine ? "flex-row-reverse" : ""}`}
              >
                <Avatar role={role} />
                <div className={`max-w-[80%] ${mine ? "text-right" : ""}`}>
                  <div className="text-xs text-gray-500">
                    {role ? `${role.name} · ${role.title}` : "You"}
                  </div>
                  <div
                    className={`mt-1 rounded-2xl px-3 py-2 text-left text-sm whitespace-pre-wrap ${
                      mine
                        ? "bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900"
                        : "bg-white shadow-sm dark:bg-gray-800"
                    }`}
                  >
                    {withMentions(m.text)}
                  </div>
                </div>
              </div>
            );
          })}
          {state.working.map((id) => (
            <div key={id} className="flex items-center gap-2 text-xs text-gray-500">
              <Avatar role={roleById(id)} /> {roleById(id)?.name} is typing…
            </div>
          ))}
          <div ref={bottomRef} />
        </div>

        <form
          className="border-t border-gray-200 bg-white p-3 dark:border-gray-800 dark:bg-gray-900"
          onSubmit={(e) => {
            e.preventDefault();
            send();
          }}
        >
          <div className="mb-2 flex flex-wrap gap-1">
            {ROLES.map((role) => (
              <button
                key={role.id}
                type="button"
                onClick={() => tag(role)}
                className="rounded-full border border-gray-300 px-2 py-0.5 text-xs hover:bg-gray-100 dark:border-gray-700 dark:hover:bg-gray-800"
              >
                @{role.id}
              </button>
            ))}
          </div>
          <div className="flex gap-2">
            <textarea
              ref={inputRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
              rows={2}
              placeholder="Message the team… use @lead, @backend, @frontend, @qa, @devops"
              aria-label="Message the team"
              className="flex-1 resize-none rounded-lg border border-gray-300 bg-transparent p-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 dark:border-gray-700"
            />
            <button
              type="submit"
              disabled={!connected || !draft.trim()}
              className="rounded-lg bg-violet-600 px-4 text-sm font-medium text-white disabled:opacity-40"
            >
              Send
            </button>
          </div>
        </form>
      </main>

      {viewing && (
        <aside
          className="fixed inset-0 z-10 flex flex-col bg-white p-4 md:static md:w-80 md:border-l md:border-gray-200 dark:bg-gray-900 md:dark:border-gray-800"
          aria-label={`${viewing.name}'s memory`}
        >
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-semibold">
              {viewing.name}'s memory ({memories?.length ?? "…"}/{MEMORY_CAP})
            </h2>
            <button
              type="button"
              onClick={() => setViewing(null)}
              className="text-sm text-gray-500 hover:underline"
            >
              Close
            </button>
          </div>
          <p className="mb-3 text-xs text-gray-500">
            Only what {viewing.name} chose to keep. Replies use the closest
            matches found by vector search plus the latest few.
          </p>
          <ol className="flex-1 space-y-2 overflow-y-auto text-xs">
            {memories?.length === 0 && (
              <li className="text-gray-500">Nothing remembered yet.</li>
            )}
            {memories?.map((m) => (
              <li
                key={m.id}
                className="rounded-lg bg-gray-100 p-2 dark:bg-gray-800"
              >
                <div className="mb-1 font-medium">
                  {roleById(m.author)?.name ?? "You"}
                </div>
                <div className="whitespace-pre-wrap">{m.text}</div>
              </li>
            ))}
          </ol>
        </aside>
      )}
    </div>
  );
}
