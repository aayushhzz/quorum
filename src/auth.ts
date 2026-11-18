// Shared-passcode auth. The cookie holds an HMAC derived from the passcode, so
// it is stateless, and changing the passcode signs everyone out.

export const AUTH_COOKIE = "team_auth";
const MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

export async function authToken(passcode: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(passcode),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const mac = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode("team-chat-v1")
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

/** True when the request carries a cookie for the current passcode. Fails closed if no passcode is set. */
export async function isAuthorized(
  request: Request,
  passcode: string | undefined
): Promise<boolean> {
  if (!passcode) return false;
  const cookie = readCookie(request.headers.get("Cookie"), AUTH_COOKIE);
  return !!cookie && safeEqual(cookie, await authToken(passcode));
}

export async function checkPasscode(
  given: unknown,
  passcode: string | undefined
): Promise<boolean> {
  if (!passcode || typeof given !== "string" || !given) return false;
  return safeEqual(await authToken(given), await authToken(passcode));
}

export async function authCookie(passcode: string): Promise<string> {
  return `${AUTH_COOKIE}=${await authToken(passcode)}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${MAX_AGE_SECONDS}`;
}
