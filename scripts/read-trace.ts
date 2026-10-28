import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { safeCoordinatorEvent } from "./intake-trace-view";

// View an existing execution; this command never invokes a model or a tool.
const args = process.argv.slice(2);
const run = args[args.indexOf("--run") + 1];
const agent = args.includes("--agent") ? args[args.indexOf("--agent") + 1] : undefined;
if (!args.includes("--run") || !/^[a-zA-Z0-9-]{1,80}$/.test(run ?? "") ||
    (args.includes("--agent") && !["research", "reader", "consistency", "coordinator"].includes(agent ?? "")) ||
    (agent === "coordinator" && !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(run ?? "")) ||
    args.filter(arg => arg === "--run").length !== 1 || args.filter(arg => arg === "--agent").length > 1 ||
    args.filter(arg => arg === "--follow").length > 1 ||
    args.length !== 2 + (args.includes("--agent") ? 2 : 0) + (args.includes("--follow") ? 1 : 0)) {
  console.error("Usage: npm run agents:trace -- --run <run-id> [--agent research|reader|consistency|coordinator] [--follow]");
  process.exit(1);
}
const path = join(process.cwd(), ".tools", agent === "coordinator" ? "intake-runs" : "agent-runs", run, "events.jsonl");
const safeString = (value: unknown) => typeof value === "string" && /^[a-zA-Z0-9_.:-]{1,100}$/.test(value);
const safeNumber = (value: unknown) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const safeDate = (value: unknown) => typeof value === "string" && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value);
let printed = 0;
let stopped = false;
process.once("SIGINT", () => { stopped = true; });
do {
  let raw: string;
  try { raw = await readFile(path, "utf8"); }
  catch { console.error("Trace unavailable. Run the harness first and use its run ID."); process.exitCode = 1; break; }
  const lines = raw.split("\n");
  // A partially written final event is revisited on the next iteration.
  const complete = lines.length - 1;
  for (; printed < complete; printed++) {
    try {
      const event = JSON.parse(lines[printed]) as Record<string, unknown>;
      if (!event || typeof event !== "object" || Array.isArray(event)) throw Error("invalid event");
      if (agent && event.agentId !== agent && event.agent !== agent) continue;
      if (agent === "coordinator" && !safeCoordinatorEvent(event, run)) throw Error("invalid coordinator event");
      const fields = ["at", "timestamp", "agentId", "agent", "event", "status", "code", "reasonCode", "durationMs", "taskId", "operationId", "traceId", "attempt", "revision", "httpStatus", "field", "issue", "path", "limit", "modelId"];
      const safe = Object.fromEntries(fields.filter(key => key in event &&
        (["at", "timestamp"].includes(key) ? safeDate(event[key]) : ["durationMs", "attempt", "revision", "limit"].includes(key) ? safeNumber(event[key]) : key === "httpStatus" ? safeNumber(event[key]) && Number(event[key]) >= 100 && Number(event[key]) <= 599 : key === "path" ? agent === "coordinator" && typeof event[key] === "string" : safeString(event[key]))).map(key => [key, event[key]]));
      if (!safe.event && !safe.status) throw Error("invalid event");
      console.log(JSON.stringify(safe));
    } catch { console.error("Malformed trace event withheld."); }
  }
  if (!args.includes("--follow") || stopped) break;
  await delay(500);
} while (!stopped);
