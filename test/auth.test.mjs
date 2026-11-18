import { test } from "node:test";
import assert from "node:assert/strict";
import {
  AUTH_COOKIE,
  LOGIN_LIMITS,
  SESSION_TTL_SECONDS,
  checkPasscode,
  clearedCookie,
  createSession,
  isAuthorized,
  loginBlocked,
  readCookie,
  safeEqual,
  sessionCookie,
  verifySession
} from "../src/auth.ts";

const S = { passcode: "secret", sessionSecret: "k".repeat(32) };
const NOW = 1_800_000_000_000;
const req = (cookie) =>
  new Request("https://x.test/agents/team-room/main", {
    headers: cookie ? { Cookie: cookie } : {}
  });

test("safeEqual and readCookie", () => {
  assert.equal(safeEqual("abc", "abc"), true);
  assert.equal(safeEqual("abc", "abd"), false);
  assert.equal(safeEqual("abc", "ab"), false);
  assert.equal(readCookie("x=1; team_auth=a.b.c; y=2", "team_auth"), "a.b.c");
  assert.equal(readCookie(null, "team_auth"), undefined);
});

test("checkPasscode accepts only the right passcode and fails closed", async () => {
  assert.equal(await checkPasscode("secret", "secret"), true);
  assert.equal(await checkPasscode("wrong", "secret"), false);
  assert.equal(await checkPasscode("", "secret"), false);
  assert.equal(await checkPasscode(123, "secret"), false);
  assert.equal(await checkPasscode("secret", undefined), false);
});

test("sessions verify, are unique, and do not embed the passcode", async () => {
  const a = await createSession(S, NOW);
  const b = await createSession(S, NOW);
  assert.notEqual(a, b);
  assert.ok(!a.includes("secret"));
  assert.equal(await verifySession(a, S, NOW), true);
});

test("sessions expire server-side and reject future issue times", async () => {
  const t = await createSession(S, NOW);
  assert.equal(await verifySession(t, S, NOW + SESSION_TTL_SECONDS * 1000), true);
  assert.equal(await verifySession(t, S, NOW + (SESSION_TTL_SECONDS + 1) * 1000), false);
  assert.equal(await verifySession(t, S, NOW - 5000), false);
});

test("sessions die when either secret changes, and fail closed", async () => {
  const t = await createSession(S, NOW);
  assert.equal(await verifySession(t, { ...S, passcode: "rotated" }, NOW), false);
  assert.equal(await verifySession(t, { ...S, sessionSecret: "other" }, NOW), false);
  assert.equal(await verifySession(t, { passcode: "secret" }, NOW), false);
  assert.equal(await verifySession(undefined, S, NOW), false);
});

test("tampered or malformed tokens are rejected", async () => {
  const t = await createSession(S, NOW);
  const [iat, nonce, sig] = t.split(".");
  assert.equal(await verifySession(`${Number(iat) + 1}.${nonce}.${sig}`, S, NOW), false);
  assert.equal(await verifySession(`${iat}.x${nonce}.${sig}`, S, NOW), false);
  assert.equal(await verifySession(`${t}.extra`, S, NOW), false);
  assert.equal(await verifySession("abc.def.ghi", S, NOW), false);
  assert.equal(await verifySession("", S, NOW), false);
});

test("isAuthorized reads the cookie", async () => {
  const t = await createSession(S, NOW);
  assert.equal(await isAuthorized(req(`${AUTH_COOKIE}=${t}`), S, NOW), true);
  assert.equal(await isAuthorized(req(), S, NOW), false);
});

test("cookies are HttpOnly, Secure, SameSite=Strict; logout clears", () => {
  for (const c of [sessionCookie("t"), clearedCookie()]) {
    for (const flag of ["HttpOnly", "Secure", "SameSite=Strict", "Path=/"]) {
      assert.ok(c.includes(flag), flag);
    }
  }
  assert.ok(clearedCookie().includes("Max-Age=0"));
});

test("loginBlocked enforces per-IP and global limits", () => {
  assert.equal(loginBlocked(0, 0), false);
  assert.equal(loginBlocked(LOGIN_LIMITS.perIpPerMinute - 1, 0), false);
  assert.equal(loginBlocked(LOGIN_LIMITS.perIpPerMinute, 0), true);
  assert.equal(loginBlocked(0, LOGIN_LIMITS.globalPerHour), true);
});
