# PopPD — Phase 0 spike report

**Date:** 2026-11-15 · **Machine:** Windows 11 (`Vero`) · **Engine:** OpenCode 2.3.0 ·
**Client:** `@opencode/client` 2.3.0 · **Model:** `opencode-go/deepseek-v4.1-flash`

**Question:** can an embedded OpenCode engine plus a thin PopPD layer turn a plain-language,
non-technical request into a finished artifact that opens with one click — autonomously,
with no approvals and no developer instructions?

**Verdict: GO**, with two product-level fixes the spike itself surfaced:

1. **Absolute instruction paths are mandatory.** A relative `instructions` path is
   resolved against the session workspace and silently dropped — the agent then behaves
   like plain OpenCode. This was the difference between "I'm DeepSeek running as
   OpenCode" and "I'm PopPD, your friendly builder".
2. **The last mile must be guaranteed by the shell, not the model.** The model can open
   the result (it did), but launcher creation is not reliable enough to be the only
   mechanism. The shell now writes `Open this.bat` whenever an HTML artifact exists.

---

## How the spike ran

Every run used the production-shaped path: PopPD spawned **its own** OpenCode engine
(`opencode serve` on an ephemeral port), created a session bound to a workspace folder,
prompted with a `pop` agent, streamed events for evidence, then audited the workspace.

| Piece | File |
| --- | --- |
| Config (model pin, agent, permissions, policy) | `spike/opencode.jsonc` |
| Constitution v0 | `spike/instructions/popd-rules.md` |
| Last-mile plugin (`open_with_default_app`, `show_in_folder`, `escalate`) | `spike/popd-plugin/server.ts` |
| Run harness + audit | `spike/driver.mjs` |
| Experiment matrix | `spike/run-all.mjs` |
| Artifact verifier | `spike/verify.mjs` |
| Dev-speak lint | `spike/lint.mjs` |

Cases: a concrete web app (`pomodoro`), a deliberately vague request (`chores`), a
one-line smoke test, and an identity probe.

---

## Results

| ID | Experiment | Result | Evidence |
| --- | --- | --- | --- |
| E1 | Service bootstrap via the V2 client | **PASS** | Private engine started on an ephemeral port in ~1 s; `/api/info` healthy; no manual steps |
| E2 | Config authority | **PASS** | `pop` is the only visible primary; `plan` → "Agent not found"; `build.hidden = true`; plugin `popd` loaded; MCP policy leaves `mcp.list` empty; model pinned |
| E3 | Autonomous run, zero approvals | **PASS** | **0** `permission.asked` events across every run |
| E4 | Last mile | **PASS** | Agent wrote `index.html` (22.5 KB) **and `Open this.bat`**, then called `open_with_default_app` (plugin log); the launcher runs with exit 0 and opens the page |
| E5 | No developer-speak | **PASS** | Lint clean; final message: *"Your timer is ready and should already be open in your browser… Next time just double-click Open this.bat…"* |
| E6 | Loose ends (vague prompt) | **PASS (with a note)** | Ran to completion (610 s) and produced a working `chores.html`; it made assumptions instead of asking — acceptable, but it also left test scripts/screenshots in the folder (see findings) |
| E7 | Clean failures | **PASS** | A bogus model id ended as `failed` instead of hanging |
| E8 | Persistence | **PASS** | A fresh process read the full session: 44 messages, outcome `succeeded` |
| E9 | Budget | **PASS** | See table below |

### Measured runs

| Run | Wall | Tokens in / out | Est. cost | Asks | Launcher | Open tool | Lint |
| --- | --- | --- | --- | --- | --- | --- | --- |
| pomodoro (pre-constitution) | 366 s | 46,960 / 13,836 | **$0.015** | 0 | agent missed it | called | clean |
| pomodoro (constitution active) | **531 s** | 57,335 / 18,142 | **$0.0195** | 0 | **agent wrote it** | called | clean |
| chores (vague) | 610 s | 89,232 / 27,882 | **$0.030** | 0 | agent missed it | called | clean |
| bad model | ~4 s | — | — | 0 | — | — | — |

Cost is estimated from tokens at Go prices ($0.15 / $0.60 per M); `session.cost` itself
reports 0, so the product must compute budget from usage.

The delivered pomodoro app (22.5 KB) is genuinely good: design tokens, focus/break
themes, inline SVG favicon, a progress ring, a daily "stretches" counter persisted in
`localStorage`, keyboard shortcuts, and a responsive layout.

---

## What the spike taught us (and what Phase 1 must build)

### 1. Instruction paths are the product

- `"instructions": ["./instructions/popd-rules.md"]` **loads the config but drops the
  file** (resolved relative to the session workspace) — the persona vanishes silently.
- `"instructions": ["C:/…/spike/instructions/popd-rules.md"]` makes the agent answer
  *"I'm PopPD, your friendly builder…"* and follow the delivery rules.
- **Action:** PopPD writes absolute paths for `instructions` and plugin packages, and
  verifies the persona on startup (an identity probe is a 5-second health check).

### 2. The last mile needs two layers

- The model reliably **builds** and **opens** the result (plugin `open_with_default_app`
  was called in every successful run, including from inside Code Mode).
- It does **not** reliably create the launcher: two of three runs skipped
  `Open this.bat`. With the constitution active it did create it — but one data point is
  not a guarantee.
- **Action:** the shell writes the launcher itself when an HTML artifact exists (already
  implemented in `driver.mjs` + `verify.mjs`), and the model keeps the "open it" job.

### 3. Autonomy is a config guarantee

- Base permissions are allow-all; two `.env` allow rules remove the only default `ask`.
- Zero permission prompts in every run, including shell, writes, and network.
- The permission sweep remains as a safety net (auto-answer `once`).

### 4. Engine supervision is non-negotiable

- The shared engine on the machine was not a stable substrate: restarts orphaned
  sessions, and deleting a workspace under a live session produced
  `Failed to drain Session: DirectoryNotFoundError`.
- A child engine's stdout **must keep being drained**; an unread pipe eventually blocks
  the engine on a log write and the run looks hung. This cost the spike an hour.
- **Action:** PopPD spawns and supervises its own engine, drains stdout/stderr, restarts
  on crash, and never deletes a workspace without stopping its session first.

### 5. Completion and input are polled, not streamed

- The SSE stream did not deliver `session.idle`; `session.get().outcome` is the reliable
  completion signal.
- Forms (questions) and permission requests must be polled (`session.form.list`,
  `permission.request.list`) — the event stream alone can miss them and wedge a run.
- A **stall watchdog** (interrupt after ~4 min with no `time.updated` progress) is
  mandatory; without it the UI can look frozen forever.

### 6. There are long runs

- A small app took **6–9 minutes**; a vague request with self-verification took 10.
- **Action:** generous timeouts, visible progress, and a "still working" state that
  survives the window losing focus.

### 7. Workspace hygiene

- The vague-prompt run left `_test.mjs`, `_serve.cjs`, `shot-light.png` next to the
  deliverable.
- **Action:** keep deliverables in a `deliver/` subfolder (or hide leading-underscore
  scaffolding in the results view), and show only "the thing" in the UI.

### 8. Cost and key handling

- Cost: ~**1.5–3 cents** per artifact on flash; the UI can honestly say "a few cents".
- Key entry: `client.integration.connect.key({ integrationID: "opencode-go", key })`
  (the catalog exposes a `key` method; `OPENCODE_API_KEY` also works).
- `agent.list` can be empty on a freshly spawned engine even when the persona and plugin
  work; do not gate the UI on that call (use `default_agent`, verify via the identity
  probe).

---

## v0 defaults delivered

`evidence/V0-DEFAULTS.md` contains the exact config PopPD should ship: model pin,
`pop` agent, plan disabled, build hidden, allow-all permissions, MCP deny policy,
absolute instruction path, key entry, and update behaviour.

---

## Reproduce

```powershell
cd spike
bun install
node driver.mjs --case identity --timeout 3 --private     # persona check (~9 s)
node driver.mjs --case pomodoro --timeout 20 --private    # full artifact (~9 min)
node driver.mjs --deliver runs\<workspace>                 # last-mile guarantee
node verify.mjs runs\<workspace>                           # static audit
node run-all.mjs                                           # the matrix
```

Raw evidence: `runs/*/summary.json`, `runs/*/events.jsonl`, `runs/_plugin.log`,
`evidence/results.json`.

---

## Recommendation

Build Phase 1 as planned, with these changes folded in:

1. Engine supervisor + stdout drain + stall watchdog (already prototyped).
2. Shell-side launcher generation + artifact verification + auto-open.
3. Absolute instruction/plugin paths, plus a startup identity probe.
4. Deliverables in a clean `deliver/` folder; scaffolding hidden.
5. Poll-based completion/forms/permissions; stream only for display.
6. Keep `deepseek-v4.1-flash` as the default; expose the model switch in Settings
   (`deepseek-v4-pro` is the step up for harder builds).

The loop is real, cheap, and fast enough to demo. The remaining risk is not the agent —
it is the plumbing around it, and that plumbing now has a working prototype and a list
of named failure modes.
