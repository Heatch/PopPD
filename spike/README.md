# PopPD spike (Phase 0)

This is the evidence harness for the PopPD plan. It answers one question before any
product code exists:

> Can an embedded OpenCode engine plus a thin PopPD layer turn a plain-language,
> non-technical request into a finished artifact the person can open with one click —
> autonomously, with no approvals and no developer instructions?

Everything here runs through the path the Electron shell will use: the
`@opencode/client` V2 client connects to a real OpenCode service, sessions are bound
to a workspace directory, and a local plugin supplies the "last mile" tools.

## Layout

```
spike/
├─ opencode.jsonc            PopPD config (model pin, pop agent, plan disabled,
│                            allow-all permissions, MCP policy)
├─ setup.mjs                 writes the absolute instruction path (required)
├─ instructions/
│  └─ popd-rules.md          The PopPD constitution, v0
├─ popd-plugin/
│  └─ server.ts              open_with_default_app · show_in_folder · escalate
├─ cases/
│  ├─ pomodoro.md            concrete request: a small web app
│  ├─ chores.md              vague request: tests loose-end handling
│  ├─ smoke.md               one-line sanity check
│  └─ identity.md            persona check ("I'm PopPD…")
├─ driver.mjs                one instrumented run (own engine, events, audit, summary)
├─ lint.mjs                  dev-speak detector for the final message
├─ verify.mjs                static audit of a delivered workspace
├─ run-all.mjs               the E1–E9 matrix, writes evidence/
├─ runs/                     every run: workspace, events.jsonl, summary.json (gitignored)
└─ evidence/                 EVIDENCE.md, V0-DEFAULTS.md, findings, raw results
```

## Prerequisites

- Node 22+ (the V2 client needs a modern fetch/stream runtime)
- OpenCode 2.3+ on PATH with an `opencode-go` credential (the engine is what PopPD
  will eventually bundle)

## Setup

```bash
bun install         # or: npm install
node setup.mjs      # writes the absolute instruction path
```

`setup.mjs` matters: OpenCode resolves `instructions` against the session workspace,
not this config file, and silently ignores a missing file. Without this step the agent
introduces itself as plain OpenCode instead of PopPD.

## Run

```powershell
cd spike

# E1/E2 only, no model cost (uses the machine's shared engine)
node driver.mjs --config-check

# one case, with PopPD's own bundled engine (the production shape)
node driver.mjs --case smoke --timeout 4 --private
node driver.mjs --case pomodoro --timeout 20 --private

# the full matrix (spawns its own engine on an ephemeral port)
node run-all.mjs

# apply the last-mile guarantee to an existing workspace (writes Open this.bat)
node driver.mjs --deliver runs\<workspace>

# static audit of a delivered workspace
node verify.mjs runs\<workspace>
```

Each run creates `runs/<case>-<timestamp>/` with the deliverable, `events.jsonl`
(the full engine event stream), `summary.json`, and `final-message.md`.

## What each experiment proves

| ID | Experiment | Pass means |
| --- | --- | --- |
| E1 | Service bootstrap via the V2 client | Service discovered/started with no manual steps |
| E2 | Config authority | `pop` is the only visible primary; `plan` gone; build hidden; model pinned |
| E3 | Autonomous artifact run | Run completes; zero permission requests; writes stay in the workspace |
| E4 | Last mile | `Open this.bat` exists; the agent calls `open_with_default_app` |
| E5 | No developer-speak | Final messages pass the lint |
| E6 | Loose ends | Vague prompt either asks a structured question or states assumptions, then delivers |
| E7 | Clean failures | A bogus model fails visibly instead of hanging |
| E8 | Persistence | A fresh process can read the full session history |
| E9 | Budget | Duration, tokens, and estimated cost per artifact |

## Notes

- `--private` makes the harness spawn its own OpenCode engine on an ephemeral port —
  the shape the product will use. Without it, the driver talks to the machine's shared
  service (fine for the config check).
- MCP servers inherited from the machine config are denied by policy so the agent's
  tool surface stays small; this is what the Settings screen will configure.
