const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);
const CONNECTION_TARGET_OVERRIDES = new Set(["host", "port"]);
const AMBIENT_TARGET_OVERRIDES = ["PGHOST", "PGHOSTADDR", "PGPORT", "PGDATABASE"] as const;

export function assertNoPostgresTargetOverrides(value: string | URL): URL {
  const url = typeof value === "string" ? new URL(value) : value;
  for (const key of url.searchParams.keys()) {
    if (CONNECTION_TARGET_OVERRIDES.has(key.toLowerCase())) {
      throw new Error("PostgreSQL connection URLs must not override host or port in query parameters.");
    }
  }
  return url;
}

export function assertNoAmbientPostgresTargetOverrides(environment: Readonly<Record<string, string | undefined>> = process.env): void {
  const active = AMBIENT_TARGET_OVERRIDES.filter(key => Boolean(environment[key]?.trim()));
  if (active.length) {
    throw new Error(`PostgreSQL test environment cannot set target overrides: ${active.join(", ")}.`);
  }
}

export function assertSafePostgresTestTarget(value: string | URL, environment: Readonly<Record<string, string | undefined>> = process.env): URL {
  assertNoAmbientPostgresTargetOverrides(environment);
  const url = assertNoPostgresTargetOverrides(value);
  if (!url.port) throw new Error("PostgreSQL test URL must include an explicit port.");
  return url;
}

function normalizedPostgresTarget(value: URL) {
  const url = assertNoPostgresTargetOverrides(value);
  const hostname = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  const protocol = url.protocol === "postgres:" || url.protocol === "postgresql:"
    ? "postgres"
    : url.protocol;
  return {
    protocol,
    hostname: LOOPBACK_HOSTS.has(hostname) ? "loopback" : hostname,
    port: url.port || "5432",
    database: decodeURIComponent(url.pathname.replace(/^\//, "")),
  };
}

/** Compare server/database identity while treating local aliases and the default port as equivalent. */
export function samePostgresTarget(left: string | URL, right: string | URL): boolean {
  const a = normalizedPostgresTarget(typeof left === "string" ? new URL(left) : left);
  const b = normalizedPostgresTarget(typeof right === "string" ? new URL(right) : right);
  return a.protocol === b.protocol
    && a.hostname === b.hostname
    && a.port === b.port
    && a.database === b.database;
}
