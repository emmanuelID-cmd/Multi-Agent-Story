import { describe, expect, it, vi } from "vitest";

describe("Better Auth stays unbuilt without a secret", () => {
  it("returns no client when BETTER_AUTH_SECRET is absent", async () => {
    vi.stubEnv("BETTER_AUTH_SECRET", "");
    try {
      const { getAuth } = await import("../src/server/auth");
      await expect(getAuth()).resolves.toBeNull();
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("returns 401 from the session gate without throwing at import", async () => {
    vi.stubEnv("BETTER_AUTH_SECRET", "");
    try {
      const { requireReadUser } = await import("../src/server/read-http");
      await expect(requireReadUser()).rejects.toMatchObject({ status: 401, message: "Sign in to continue." });
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
