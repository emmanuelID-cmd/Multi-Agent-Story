const LOOPBACK_ORIGINS = ["http://localhost:3000", "http://127.0.0.1:3000"];

// Turns a site address into its origin: scheme, host, and port, with no path.
// A bad address returns nothing so it cannot sneak onto the allow list.
function originOf(value: string): string | null {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

// Lists the browser addresses allowed to call this app.
// Local work is only localhost and 127.0.0.1 on port 3000.
// A public site uses APP_URL when that is set, otherwise Render's RENDER_EXTERNAL_URL.
// The comparison uses the full origin. Do not trust X-Forwarded-Host; a caller can set that header.
export function allowedRequestOrigins(): string[] {
  const allowed = [...LOOPBACK_ORIGINS];
  const configured = process.env.APP_URL?.trim() || process.env.RENDER_EXTERNAL_URL?.trim();
  if (!configured) return allowed;
  const origin = originOf(configured);
  if (origin) allowed.push(origin);
  return allowed;
}

// True when the browser Origin header is one of the addresses this app serves.
// Story saves and book-metadata requests both use this so their allow lists cannot drift.
// If you add a new public address, set APP_URL. Do not match the Host header here.
export function isAllowedRequestOrigin(origin: string | null): boolean {
  if (!origin) return false;
  const normalized = originOf(origin);
  if (!normalized) return false;
  return allowedRequestOrigins().includes(normalized);
}
