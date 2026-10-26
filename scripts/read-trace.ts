import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

// View an existing execution; this command never invokes a model or a tool.
const args = process.argv.slice(2);
const run = args[args.indexOf("--run") + 1];
const agent = args.includes("--agent") ? args[args.indexOf("--agent") + 1] : undefined;
if (!args.includes("--run") || !/^[a-zA-Z0-9-]{1,80}$/.test(run ?? "") ||
    (agent && !["research", "reader", "consistency"].includes(agent))) {
  console.error("Usage: npm run agents:trace -- --run <run-id> [--agent research|reader|consistency] [--follow]");
  process.exit(1);
}
const path = join(process.cwd(), ".tools", "agent-runs", run, "events.jsonl");
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
      if (agent && event.agentId !== agent && event.agent !== agent) continue;
      const fields = ["at", "timestamp", "agentId", "agent", "event", "status", "code", "reasonCode", "durationMs", "taskId", "operationId"];
      const safe = Object.fromEntries(fields.filter(key => key in event).map(key => [key, event[key]]));
      console.log(JSON.stringify(safe));
    } catch { console.error("Malformed trace event withheld."); }
  }
  if (!args.includes("--follow") || stopped) break;
  await delay(500);
} while (!stopped);
