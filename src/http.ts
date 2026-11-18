// HTTP hardening helpers: HTTPS redirect and security headers. No Cloudflare imports.

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "connect-src 'self'",
  "font-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'"
].join("; ");

export function isLocalHost(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "[::1]" ||
    hostname.endsWith(".localhost")
  );
}

/** The https URL to redirect to, or null when no redirect is needed (already https, or local dev). */
export function httpsRedirectUrl(url: URL): string | null {
  if (url.protocol !== "http:" || isLocalHost(url.hostname)) return null;
  const secure = new URL(url);
  secure.protocol = "https:";
  return secure.toString();
}

/** Security headers for a response. CSP and HSTS are skipped locally (Vite dev injects inline scripts and serves plain http). */
export function securityHeaders(local: boolean): Record<string, string> {
  const headers: Record<string, string> = {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()"
  };
  if (!local) {
    headers["Content-Security-Policy"] = CSP;
    headers["Strict-Transport-Security"] = "max-age=31536000";
  }
  return headers;
}

/** Copies a response with security headers added. WebSocket upgrades are returned untouched. */
export function withSecurityHeaders(
  response: Response,
  local: boolean
): Response {
  if (response.status === 101) return response;
  const secured = new Response(response.body, response);
  for (const [k, v] of Object.entries(securityHeaders(local)))
    secured.headers.set(k, v);
  return secured;
}
