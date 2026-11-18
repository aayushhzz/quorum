import { test } from "node:test";
import assert from "node:assert/strict";
import { reviewDiff, formatFindings, changedFiles } from "../src/review.ts";

const diff = (file, lines, extra = "") =>
  `--- a/${file}\n+++ b/${file}\n@@ -1,1 +1,${lines.length} @@\n${lines.map((l) => "+" + l).join("\n")}\n${extra}`;

test("flags a hard-coded secret without echoing it", () => {
  const f = reviewDiff(
    diff("src/x.ts", ['const key = "sk_live_abcdef123456";'])
  );
  const high = f.find((x) => x.severity === "high");
  assert.ok(high && /Possible secret/.test(high.message));
  assert.ok(!formatFindings(f).includes("sk_live_abcdef123456"));
});

test("flags tokens and private keys by shape", () => {
  assert.ok(
    reviewDiff(
      diff("src/x.ts", ["const t = 'ghp_abcdefghijklmnopqrstuvwxyz0123';"])
    ).length
  );
  assert.ok(
    reviewDiff(diff("src/x.ts", ["-----BEGIN RSA PRIVATE KEY-----"])).length
  );
});

test("flags eval, raw HTML, debug logs, any and TODO", () => {
  const f = reviewDiff(
    diff("src/x.ts", [
      "eval(input);",
      "el.innerHTML = html;",
      "console.log(x);",
      "const a: any = 1;",
      "// TODO fix"
    ])
  );
  for (const word of ["eval", "Raw HTML", "console.log", "'any'", "TODO"])
    assert.ok(
      f.some((x) => x.message.includes(word)),
      word
    );
});

test("does not flag console.warn or error logging used by the app", () => {
  const f = reviewDiff(
    diff("src/x.ts", ['console.warn("Login failed", { ip });'])
  );
  assert.ok(!f.some((x) => /console\.log/.test(x.message)));
});

test("asks for tests when source changes without a test", () => {
  const f = reviewDiff(diff("src/team.ts", ["export const x = 1;"]));
  assert.ok(f.some((x) => /no test file changed/.test(x.message)));
  const ok = reviewDiff(
    diff("src/team.ts", ["export const x = 1;"]) +
      diff("test/team.test.mjs", ["test('x', () => {})"])
  );
  assert.ok(!ok.some((x) => /no test file changed/.test(x.message)));
});

test("empty input and clean diffs are handled", () => {
  assert.match(formatFindings(reviewDiff("")), /No diff/);
  assert.equal(changedFiles(diff("a.md", ["x"])).join(), "a.md");
});
