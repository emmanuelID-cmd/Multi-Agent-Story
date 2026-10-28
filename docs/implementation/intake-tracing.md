# Coordinator intake tracing

User-approved diagnostics amendment, October 27, 2026. This task adds visibility
to the existing intake path; it does not start Phase 3, change the agent roster,
or implement the proposed automatic research-discovery loop.

## Contract and scope

The path is the authenticated intake request, saved input/reservation,
Coordinator's Haiku request, provider response parsing, output validation,
saved result and terminal outcome. The expected correlation key is one
server-generated trace UUID carried through the request and response.

The model remains `claude-haiku-5-5`. Intake retains its existing two-attempt
maximum, 35-second deadline, 5,000 output tokens per call and 14,000 combined
input/output token budget. Diagnostics do not issue a model call or retry one.
Existing ownership, confirmation, stale-input and planning barriers remain.

Only bounded, fixed-category metadata belongs in a trace: trace/operation IDs,
stage, timestamp, attempt, numeric revision, model identifier, duration, HTTP
status and safe failure/validation categories. Schema failures may also record
an allowlisted property path (with a bounded array index) and its configured
maximum. Unknown model keys and validation values are excluded. The repair
attempt receives a rule-specific instruction without copying rejected content.
New analyses use prompt version `intake-v2`; saved `intake-v1` analyses remain
readable under the unchanged output limits. Never store the story, prompts,
provider response text, credentials, raw exception messages or validation values.
The first failure remains visible if the existing bounded repair later succeeds;
the terminal outcome and failure response code record the actual final cause,
including a later provider, stale-input or persistence failure. Reservation
guards have separate safe categories for unavailable projects/intake, started
story plans, confirmed scope, active analysis and revision conflicts. A failed
provider stream read is a transport category, distinct from malformed JSON.

Local development events use `.tools/intake-runs/<trace-id>/events.jsonl`, an
ignored project-local location. Production tracing is disabled by default.
Disabled, truncated or unwritable telemetry cannot be presented as a complete
trace, and a telemetry write failure must not change a valid analysis result.
Recording diagnostics does not establish a production retention policy or
authorize automatic deletion. No public trace-reading endpoint is added.

## Following one attempt

Use the dev server's existing terminal. If restarting it to capture output,
stop the old server with Ctrl+C before starting another instance:

```powershell
cd "C:\Users\dejes\OneDrive\Documents\Pursuit\Pursuit\_Lessons\L2-Week-5\Multi-Agent-Story"
$runtimeBin = (Get-Content .tools/runtime-path.txt).Trim()
$env:PATH = "$runtimeBin;$env:PATH"
npm.cmd run dev
```

In the browser, open Network with Preserve log and Fetch/XHR, then click
Analyze with Claude once. Use the new intake trace ID shown in the server
terminal or that request's response/header. The failure panel also identifies
the trace and whether local telemetry is available.

In another terminal, repeat the directory/runtime setup above and view that
same request, replacing the placeholder with its actual UUID:

```powershell
$traceId = "REPLACE-WITH-THE-INTAKE-TRACE-UUID"
npm.cmd run agents:trace -- --run $traceId --agent coordinator --follow
```

The viewer does not start a model. Ctrl+C stops only the viewer. It validates
Coordinator event fields and values and withholds malformed data. Existing
Research/Reader/Consistency harness commands continue to use their own run IDs;
they do not receive this saved web story.

## Verification boundary

Implementation and synthetic trace verification are in progress. Formal trace
reports and versioned evidence belong in `docs/temp/trace/` under the trace skill.
They must distinguish synthetic checks from a controlled live request, record
the authoritative PRD/prompt/model/harness versions, and use two independent
parallel reviews with reconciliation plus SECURITY execution evidence.

The earlier uninstrumented 503 cannot be assigned a confirmed root cause from
its generic response alone. A future captured attempt can identify its first
failing boundary; diagnostics alone do not prove the underlying bug is fixed.
