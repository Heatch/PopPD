# Spike findings (draft — numbers land after the matrix)

## Environment

- Windows 11 (hostname Vero), Node 22.5.1, Bun 1.4.2
- OpenCode engine 2.3.0, V2 API (`@opencode/client` 2.3.0)
- Provider `opencode-go`, model `deepseek-v4.1-flash`
- The machine already had an `opencode-go` credential

## What is already proven

### E1/E2 — config authority (no model cost)

- Our project config document loads: `model = opencode-go/deepseek-v4.1-flash`,
  `default_agent = pop`, `agents = plan, build, pop`.
- `agent.get("plan")` → **Agent not found** (disabled).
- `build.hidden = true`.
- Visible primaries at a workspace: **pop** only.
- Plugin `popd` loads from `./popd-plugin` and is active.
- `policies: mcp.use = deny` keeps every inherited MCP server disconnected
  (`mcp.list` → `[]`), so the tool surface stays small.
- `instructions` + `permissions` are part of the same document.

### E7 — key entry (mechanism verified)

- `client.integration.list()` shows `opencode-go` with a `key` method and an
  `env` method (`OPENCODE_API_KEY`), plus a live `key` credential.
- Settings can therefore call
  `client.integration.connect.key({ integrationID: "opencode-go", key })`.
- Engine auth for local clients is HTTP Basic, username `opencode`, password from
  the service registration; the SDK's `Service.headers()` does this for you.

## Observed behaviour (qualitative)

### The instruction trap (found the hard way)

The first artifact runs used `"instructions": ["./instructions/popd-rules.md"]`.
The config document loaded, the plugin loaded, the model built a good app — but the
agent introduced itself as *"DeepSeek V4.1 Flash running as OpenCode"*. Relative
instruction paths resolve against the **session workspace**, not the config file, and
a missing instruction file is dropped silently.

Switching to an absolute path changed the answer to *"I'm PopPD, your friendly
builder…"* in the same prompt. Production must write absolute paths.

### Artifact quality and cost

- A smoke prompt completes in ~4–10 s with zero permission asks.
- A real "pomodoro timer" request produced a **~20 KB single-file app**: design
  tokens, focus/break themes, inline SVG favicon, timer logic (`setInterval`),
  daily count persisted with `localStorage`, keyboard shortcuts.
- Measured: **366 s**, **46,960 input / 13,836 output** tokens, ≈ **$0.015** at
  Go prices. The vague chores prompt took **610 s**, 89k/28k tokens, ≈ **$0.03**.
- The final message passed the automated lint but was long and bullet-heavy, not the
  2–4 sentence, jargon-free reply the constitution asks for.

### Last mile

- The plugin's `open_with_default_app` **was called** (plugin log, inside Code Mode),
  so "the app opens itself" works.
- The agent **did not create `Open this.bat`** on its own, even with the constitution
  present. The shell-side auto-launcher (implemented in the driver/`verify.mjs`) makes
  delivery deterministic: if an HTML artifact exists and no launcher does, PopPD
  writes one.

## Failure modes found (important for Phase 1)

1. **Long tasks need patience, not a 2-minute timeout.** Flash took ~6–10 min for one
   small app. The shell must show progress and allow long runs.
2. **The shared engine is not a stable substrate.** Service restarts orphaned
   in-flight sessions, and deleting a workspace while its session was registered
   produced `Failed to drain Session: DirectoryNotFoundError`. PopPD must run **its
   own** engine process and supervise it.
3. **A child engine's stdout must keep being drained.** An unread pipe eventually
   blocks the engine on a log write and the whole run appears to hang. The harness
   now consumes the pipe for the engine's lifetime.
4. **Stall detection is mandatory.** A run can sit with no session updates for
   minutes; the driver interrupts after 4 minutes without progress.
5. **Event subscriptions are not a reliable control channel.** The SSE stream did
   not deliver `session.idle`; the driver polls `session.get().outcome`,
   `session.form.list` and `permission.request.list` instead.
6. **Cost accounting is zero for Go.** `session.cost` stayed 0; tokens are real.
   Budget estimates must come from token counts.
7. **Workspace hygiene.** The vague-prompt run left test scripts and screenshots
   (`_test.mjs`, `shot-light.png`, …) next to the deliverable. PopPD should hide or
   clean scaffolding, or keep deliverables in a `deliver/` folder.
8. **`agent.list` can be empty on a freshly spawned engine** even though the
   instructions and plugin apply. Verify agent visibility on the bundled engine in
   Phase 1; the persona itself is carried by `instructions`, so the product still
   behaves correctly.

## Still to verify (matrix)

- E3: zero permission asks on a full artifact run.
- E4: launcher exists, the agent calls `open_with_default_app`, the launcher runs.
- E5: no dev-speak in the final message.
- E6: vague prompt behaviour.
- E8: cross-process history.
- E9: duration/tokens per artifact.
