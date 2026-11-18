import { test } from "node:test";
import assert from "node:assert/strict";
import {
  httpsRedirectUrl,
  isLocalHost,
  securityHeaders,
  withSecurityHeaders
} from "../src/http.ts";

test("httpsRedirectUrl upgrades public http only", () => {
  assert.equal(
    httpsRedirectUrl(new URL("http://app.example.workers.dev/a?b=1")),
    "https://app.example.workers.dev/a?b=1"
  );
  assert.equal(
    httpsRedirectUrl(new URL("https://app.example.workers.dev/")),
    null
  );
  assert.equal(httpsRedirectUrl(new URL("http://localhost:5173/")), null);
  assert.equal(isLocalHost("127.0.0.1"), true);
  assert.equal(isLocalHost("evil-localhost.com"), false);
});

test("production headers include CSP, HSTS and anti-framing", () => {
  const h = securityHeaders(false);
  assert.match(h["Content-Security-Policy"], /frame-ancestors 'none'/);
  assert.match(h["Content-Security-Policy"], /script-src 'self'/);
  assert.ok(!h["Content-Security-Policy"].includes("unsafe-inline"));
  assert.match(h["Strict-Transport-Security"], /max-age=\d+/);
  assert.equal(h["X-Content-Type-Options"], "nosniff");
  assert.equal(h["X-Frame-Options"], "DENY");
  const local = securityHeaders(true);
  assert.equal(local["Content-Security-Policy"], undefined);
  assert.equal(local["X-Content-Type-Options"], "nosniff");
});

test("withSecurityHeaders adds headers and keeps status and body", async () => {
  const r = withSecurityHeaders(new Response("hi", { status: 404 }), false);
  assert.equal(r.status, 404);
  assert.equal(await r.text(), "hi");
  assert.equal(r.headers.get("X-Frame-Options"), "DENY");
});
