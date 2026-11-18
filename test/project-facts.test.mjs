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
