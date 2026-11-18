import { test } from "node:test";
import assert from "node:assert/strict";
import {
  AUTH_COOKIE,
  authCookie,
  authToken,
  checkPasscode,
  isAuthorized,
  readCookie,
  safeEqual
} from "../src/auth.ts";

const req = (cookie) =>
  new Request("https://x.test/agents/team-room/main", {
    headers: cookie ? { Cookie: cookie } : {}
  });

test("authToken is deterministic and passcode-specific", async () => {
  assert.equal(await authToken("a"), await authToken("a"));
  assert.notEqual(await authToken("a"), await authToken("b"));
});

test("safeEqual and readCookie", () => {
  assert.equal(safeEqual("abc", "abc"), true);
  assert.equal(safeEqual("abc", "abd"), false);
  assert.equal(safeEqual("abc", "ab"), false);
  assert.equal(readCookie("x=1; team_auth=t=ok; y=2", "team_auth"), "t=ok");
  assert.equal(readCookie(null, "team_auth"), undefined);
});

test("checkPasscode accepts only the right passcode and fails closed", async () => {
  assert.equal(await checkPasscode("secret", "secret"), true);
  assert.equal(await checkPasscode("wrong", "secret"), false);
  assert.equal(await checkPasscode("", "secret"), false);
  assert.equal(await checkPasscode(123, "secret"), false);
  assert.equal(await checkPasscode("secret", undefined), false);
});

test("isAuthorized requires the cookie for the current passcode", async () => {
  const token = await authToken("secret");
  assert.equal(await isAuthorized(req(`${AUTH_COOKIE}=${token}`), "secret"), true);
  assert.equal(await isAuthorized(req(`${AUTH_COOKIE}=${token}`), "rotated"), false);
  assert.equal(await isAuthorized(req(`${AUTH_COOKIE}=nope`), "secret"), false);
  assert.equal(await isAuthorized(req(), "secret"), false);
  assert.equal(await isAuthorized(req(`${AUTH_COOKIE}=${token}`), undefined), false);
});

test("authCookie is HttpOnly, Secure and SameSite=Strict", async () => {
  const c = await authCookie("secret");
  for (const flag of ["HttpOnly", "Secure", "SameSite=Strict", "Path=/"]) {
    assert.ok(c.includes(flag), flag);
  }
});
