import { describe, expect, it, vi } from "vitest";
import { configuredAuthOrigin } from "../src/server/auth";

describe("configured Better Auth origin", () => {
  it("accepts HTTPS deployment origins and local HTTP development origins", () => {
    expect(configuredAuthOrigin("https://story.example.test/path")).toBe("https://story.example.test");
    expect(configuredAuthOrigin("http://localhost:3000/login")).toBe("http://localhost:3000");
    expect(configuredAuthOrigin("http://127.0.0.1:3000/login")).toBe("http://127.0.0.1:3000");
    expect(configuredAuthOrigin("http://[::1]:3000/login")).toBe("http://[::1]:3000");
  });

  it("rejects non-local HTTP and malformed deployment origins", () => {
    expect(configuredAuthOrigin("http://story.example.test")).toBeUndefined();
    expect(configuredAuthOrigin("not a URL")).toBeUndefined();
    expect(configuredAuthOrigin(undefined)).toBeUndefined();
  });
});

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
