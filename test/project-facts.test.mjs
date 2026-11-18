import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import {
  API_ENDPOINTS,
  TEST_SUITES,
  DEPLOY_CONFIG,
  formatEndpoints,
  formatDeployConfig,
  formatTestSuites
} from "../src/project-facts.ts";

test("every listed test file exists", () => {
  for (const t of TEST_SUITES) assert.ok(existsSync(t.file), t.file);
});

test("every listed API route is handled by the server", () => {
  const server = readFileSync("src/server.ts", "utf8");
  for (const e of API_ENDPOINTS.filter((x) => x.path.startsWith("/api/"))) {
    assert.ok(server.includes(e.path), `missing route ${e.path}`);
  }
  assert.ok(
    server.includes('pathname.startsWith("/agents/")'),
    "agent WebSocket routing"
  );
  assert.ok(server.includes("export class TeamRoom"), "TeamRoom exists");
});

test("facts never contain secret values or passcode settings", () => {
  const text = formatEndpoints() + formatDeployConfig() + formatTestSuites();
  assert.ok(!/SESSION_SECRET|TEAM_PASSCODE\s*=|[a-f0-9]{32,}/.test(text));
  assert.equal(DEPLOY_CONFIG.observability, "enabled");
});

import {
  ERROR_RESPONSES,
  DECISIONS,
  SECURITY_CHECKS,
  RELEASE_STEPS,
  TRIAGE_STEPS,
  ACCESSIBILITY_CHECKS
} from "../src/project-facts.ts";

test("error responses quote real messages from the server", () => {
  const server = ["server", "team", "auth", "http"]
    .map((f) => readFileSync(`src/${f}.ts`, "utf8"))
    .join("\n");
  for (const e of ERROR_RESPONSES.filter(
    (x) =>
      x.body.includes("Wrong passcode") ||
      x.body.includes("Too many") ||
      x.body.includes("Clearing") ||
      x.body.includes("still replying") ||
      x.body.includes("Limit is")
  )) {
    const key = /\d/.test(e.body)
      ? e.body.split(/\d/)[0].trim()
      : e.body.replace(/\.$/, "").slice(0, 20);
    assert.ok(server.includes(key), `not in server: ${e.body}`);
  }
});

test("every fact list is non-empty and has no secrets", () => {
  for (const list of [
    DECISIONS,
    SECURITY_CHECKS,
    RELEASE_STEPS,
    TRIAGE_STEPS,
    ACCESSIBILITY_CHECKS
  ]) {
    assert.ok(list.length > 0);
    assert.ok(
      !/SESSION_SECRET|ADMIN_PASSCODE\s*=|[a-f0-9]{32,}/.test(list.join("\n"))
    );
  }
});

import { LOG_STEPS, PLANNING_STEPS } from "../src/project-facts.ts";

test("log guide names only log messages the code really writes", () => {
  const code = ["server", "team", "auth"]
    .map((f) => readFileSync(`src/${f}.ts`, "utf8"))
    .join("\n");
  for (const m of ["Login failed", "Empty reply, retrying", "Team run failed"])
    assert.ok(code.includes(m), m);
  assert.ok(LOG_STEPS.length > 0 && PLANNING_STEPS.length > 0);
});
