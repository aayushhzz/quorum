// Shared-passcode auth with signed, expiring session cookies.
// Token: `<issuedAt>.<nonce>.<sig>`, sig = HMAC(SESSION_SECRET, issuedAt.nonce.passcode).
// A leaked cookie reveals nothing about the passcode (the key is a separate
// random secret), expires server-side, and dies when either secret changes.

export const AUTH_COOKIE = "team_auth";
export const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;
/** Failed logins allowed per IP per minute, and across all IPs per hour. */
export const LOGIN_LIMITS = { perIpPerMinute: 5, globalPerHour: 50 };

export interface AuthSecrets {
  passcode?: string;
  sessionSecret?: string;
}

async function hmacHex(key: string, message: string): Promise<string> {
  const k = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const mac = await crypto.subtle.sign(
    "HMAC",
    k,
    new TextEncoder().encode(message)
  );
  return [...new Uint8Array(mac)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Constant-time string comparison, so response timing doesn't leak the token. */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function readCookie(
  header: string | null,
  name: string
): string | undefined {
  for (const part of header?.split(";") ?? []) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return v.join("=");
  }
  return undefined;
}

export async function checkPasscode(
  given: unknown,
  passcode: string | undefined
): Promise<boolean> {
  if (!passcode || typeof given !== "string" || !given) return false;
  // Compare fixed-length digests so the check is constant-time.
  return safeEqual(
    await hmacHex("passcode-check", given),
    await hmacHex("passcode-check", passcode)
  );
}

export async function createSession(
  s: Required<AuthSecrets>,
  nowMs: number
): Promise<string> {
  const issuedAt = Math.floor(nowMs / 1000);
  const nonce = crypto.randomUUID().replaceAll("-", "");
  const sig = await hmacHex(
    s.sessionSecret,
    `${issuedAt}.${nonce}.${s.passcode}`
  );
  return `${issuedAt}.${nonce}.${sig}`;
}

/** Valid only with both secrets set, a correct signature and an unexpired issue time. Fails closed. */
export async function verifySession(
  token: string | undefined,
  s: AuthSecrets,
  nowMs: number
): Promise<boolean> {
  if (!token || !s.passcode || !s.sessionSecret) return false;
  const [issued, nonce, sig, extra] = token.split(".");
  if (extra !== undefined || !/^\d+$/.test(issued ?? "") || !nonce || !sig)
    return false;
  const age = Math.floor(nowMs / 1000) - Number(issued);
  if (age < 0 || age > SESSION_TTL_SECONDS) return false;
  const expected = await hmacHex(
    s.sessionSecret,
    `${issued}.${nonce}.${s.passcode}`
  );
  return safeEqual(sig, expected);
}

export async function isAuthorized(
  request: Request,
  s: AuthSecrets,
  nowMs: number
): Promise<boolean> {
  return verifySession(
    readCookie(request.headers.get("Cookie"), AUTH_COOKIE),
    s,
    nowMs
  );
}

export function sessionCookie(token: string): string {
  return `${AUTH_COOKIE}=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${SESSION_TTL_SECONDS}`;
}

export function clearedCookie(): string {
  return `${AUTH_COOKIE}=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0`;
}

export function loginBlocked(
  ipFailuresLastMinute: number,
  globalFailuresLastHour: number
): boolean {
  return (
    ipFailuresLastMinute >= LOGIN_LIMITS.perIpPerMinute ||
    globalFailuresLastHour >= LOGIN_LIMITS.globalPerHour
  );
}
