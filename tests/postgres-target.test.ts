import { describe, expect, it } from "vitest";
import { assertNoAmbientPostgresTargetOverrides, assertNoPostgresTargetOverrides, assertSafePostgresTestTarget, samePostgresTarget } from "../scripts/postgres-target";

describe("PostgreSQL test target equivalence", () => {
  it.each([
    ["localhost default port", "postgresql://user:pass@localhost/phase3_test_db", "postgresql://other:secret@127.0.0.1:5432/phase3_test_db"],
    ["IPv4 and IPv6 loopback aliases", "postgres://user:pass@127.0.0.1:5432/phase3_test_db", "postgresql://other:secret@[::1]/phase3_test_db"],
    ["IPv6 and localhost aliases", "postgresql://user:pass@[::1]:5432/phase3_test_db", "postgresql://other:secret@localhost/phase3_test_db"],
  ])("treats %s as the same local database target", (_label, left, right) => {
    expect(samePostgresTarget(left, right)).toBe(true);
  });

  it.each([
    ["different database", "postgresql://localhost/phase3_test_db", "postgresql://127.0.0.1/other_db"],
    ["different non-default port", "postgresql://localhost:5432/phase3_test_db", "postgresql://127.0.0.1:55432/phase3_test_db"],
    ["different non-loopback host", "postgresql://db.example.test/phase3_test_db", "postgresql://localhost/phase3_test_db"],
  ])("keeps %s distinct", (_label, left, right) => {
    expect(samePostgresTarget(left, right)).toBe(false);
  });

  it.each([
    "postgresql://user:pass@localhost/phase3_test_db?host=remote.example&port=5432",
    "postgresql://user:pass@localhost/phase3_test_db?HOST=127.0.0.1",
    "postgresql://user:pass@localhost/phase3_test_db?PoRt=5432",
  ])("rejects connection-target query overrides: %s", value => {
    expect(() => assertNoPostgresTargetOverrides(value)).toThrow(/must not override host or port/i);
    expect(() => samePostgresTarget(value, "postgresql://127.0.0.1/phase3_test_db")).toThrow(/must not override host or port/i);
  });

  it.each(["PGHOST", "PGHOSTADDR", "PGPORT", "PGDATABASE"] as const)("rejects ambient %s target overrides", key => {
    expect(() => assertNoAmbientPostgresTargetOverrides({ [key]: "unexpected-target" })).toThrow(/target overrides/i);
    expect(() => assertSafePostgresTestTarget("postgresql://user:pass@127.0.0.1:55432/phase3_test_db", { [key]: "unexpected-target" }))
      .toThrow(/target overrides/i);
  });

  it("requires the isolated test URL to declare its port explicitly", () => {
    expect(() => assertSafePostgresTestTarget("postgresql://user:pass@127.0.0.1/phase3_test_db", {})).toThrow(/explicit port/i);
    expect(assertSafePostgresTestTarget("postgresql://user:pass@127.0.0.1:55432/phase3_test_db", {}).port).toBe("55432");
  });
});
