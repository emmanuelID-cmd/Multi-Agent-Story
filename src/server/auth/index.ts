// Holds the sign-in client after the first successful build. Story routes never build it at import time.
let clientPromise: ReturnType<typeof buildAuth> | null = null;

// Builds the sign-in client only after a secret is configured.
// Story pages can load this file with no secret and the server still starts.
// The session-gated /state path asks for a client here. With no secret, that request is signed out instead of crashing.
// Leave the secret empty unless you are restoring account sessions. Do not print its value.
export async function getAuth() {
  const secret = process.env.BETTER_AUTH_SECRET?.trim();
  if (!secret) return null;
  if (!clientPromise) {
    clientPromise = buildAuth(secret).catch(error => {
      clientPromise = null;
      throw error;
    });
  }
  return clientPromise;
}

/** Trust HTTPS deployment origins; permit HTTP only for the supported local dev hosts. */
export function configuredAuthOrigin(configuredUrl: string | undefined): string | undefined {
  if (!configuredUrl) return undefined;
  try {
    const parsed = new URL(configuredUrl);
    const localHttp = parsed.protocol === "http:" &&
      (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1" || parsed.hostname === "[::1]");
    return parsed.protocol === "https:" || localHttp ? parsed.origin : undefined;
  } catch {
    return undefined;
  }
}

// Loads Better Auth only when getAuth has already confirmed a secret.
// The database adapter stays inside this function so a missing secret does not open a connection on startup.
async function buildAuth(secret: string) {
  const { betterAuth } = await import("better-auth");
  const { drizzleAdapter } = await import("better-auth/adapters/drizzle");
  const { db } = await import("../db");
  const schema = await import("../db/schema");
  const trustedOrigins = ["http://localhost:3000", "http://127.0.0.1:3000"];
  const baseURL = configuredAuthOrigin(process.env.BETTER_AUTH_URL || process.env.RENDER_EXTERNAL_URL);
  if (baseURL && !trustedOrigins.includes(baseURL)) trustedOrigins.push(baseURL);
  return betterAuth({
    database: drizzleAdapter(db, { provider: "pg", schema }),
    secret,
    baseURL,
    trustedOrigins,
    emailAndPassword: { enabled: true, minPasswordLength: 12, maxPasswordLength: 128 },
    rateLimit: { enabled: true, window: 60, max: 60 },
  });
}
