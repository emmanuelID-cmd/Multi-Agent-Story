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

// Loads Better Auth only when getAuth has already confirmed a secret.
// The database adapter stays inside this function so a missing secret does not open a connection on startup.
async function buildAuth(secret: string) {
  const { betterAuth } = await import("better-auth");
  const { drizzleAdapter } = await import("better-auth/adapters/drizzle");
  const { db } = await import("../db");
  const schema = await import("../db/schema");
  const configuredUrl = process.env.BETTER_AUTH_URL || process.env.RENDER_EXTERNAL_URL;
  const trustedOrigins = ["http://localhost:3000", "http://127.0.0.1:3000"];
  let baseURL: string | undefined;
  if (configuredUrl) {
    try {
      const parsed = new URL(configuredUrl);
      if (parsed.protocol === "https:" || parsed.protocol === "http:") {
        baseURL = parsed.origin;
        if (!trustedOrigins.includes(parsed.origin)) trustedOrigins.push(parsed.origin);
      }
    } catch {
      // Ignore malformed optional deployment URLs; auth remains constrained to local origins.
    }
  }
  return betterAuth({
    database: drizzleAdapter(db, { provider: "pg", schema }),
    secret,
    baseURL,
    trustedOrigins,
    emailAndPassword: { enabled: true, minPasswordLength: 12, maxPasswordLength: 128 },
    rateLimit: { enabled: true, window: 60, max: 60 },
  });
}
