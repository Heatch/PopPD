# PopPD

**A wrapper around [OpenCode](https://opencode.ai) for people who don't write code.**
You describe what you want in plain words; PopPD decides the technical details, builds it,
and hands you something you open with one click.

> **Status: Phase 0 complete (spike).** This repository contains the evidence harness and
> the findings from the spike that validated the approach. The product (desktop shell,
> settings, artifact library) is not built yet — see [Roadmap](#roadmap).

## What the spike proved

An embedded OpenCode 2.3 engine plus a thin PopPD layer can run the whole loop:

- **Fully autonomous.** Zero permission prompts across every run (allow-all policy, no
  approval UI anywhere).
- **A real artifact.** A plain-language "make me a pomodoro timer" request produced a
  polished 22.5 KB single-file web app (focus/break ring, chimes, a daily counter stored
  in `localStorage`, keyboard shortcuts) with **`Open this.bat`** next to it.
- **Cheap and quick.** ~**9 minutes** and ~**2 cents** per artifact on
  `opencode-go/deepseek-v4.1-flash`.
- **It opens itself.** The agent calls a PopPD plugin tool to open the result on screen;
  the launcher is guaranteed by the shell.
- **No developer-speak.** The final message is plain: *"Your timer is ready and should
  already be open in your browser…"*
- **Clean failures and persistence.** A bogus model fails visibly instead of hanging;
  history survives process restarts.

Read the full report: **[`spike/evidence/EVIDENCE.md`](spike/evidence/EVIDENCE.md)**.

## The two findings that shaped the design

1. **Absolute instruction paths are mandatory.** A relative `instructions` path resolves
   against the session workspace and is *silently dropped* — the agent then behaves like
   plain OpenCode and introduces itself as such. PopPD writes absolute paths and verifies
   the persona at startup.
2. **The last mile belongs to the shell.** The model opens results reliably but skipped
   the launcher in most runs. The harness guarantees `Open this.bat` whenever an HTML
   artifact exists.

## Repository layout

```
.
├─ spike/                  Phase 0 evidence harness
│  ├─ opencode.jsonc       model pin · one `pop` agent · permissions · MCP policy
│  ├─ setup.mjs            resolves the absolute instruction path (required)
│  ├─ instructions/        the PopPD constitution (v0)
│  ├─ popd-plugin/         last-mile tools: open · show in folder · escalate
│  ├─ cases/               pomodoro · chores (vague) · smoke · identity
│  ├─ driver.mjs           one instrumented run, end to end
│  ├─ run-all.mjs          the E1–E9 experiment matrix
│  ├─ verify.mjs           static audit of a delivered workspace
│  ├─ lint.mjs             developer-speak detector
│  └─ evidence/            report, defaults, raw results
└─ examples/
   └─ pomodoro/            a real artifact produced by the agent during the spike
```

## Quick start

Prerequisites:

- Node 22+
- [OpenCode](https://opencode.ai) 2.3+ on your `PATH`
- An `opencode-go` credential (`opencode auth login opencode-go --method key --answer …`)

```bash
git clone https://github.com/Heatch/PopPD.git
cd PopPD/spike
bun install          # or: npm install
node setup.mjs       # writes the absolute instruction path — do not skip

node driver.mjs --case identity --timeout 3 --private     # persona check (~9 s)
node driver.mjs --case pomodoro --timeout 20 --private    # full artifact (~9 min)
node verify.mjs runs/<workspace>                          # audit it
node run-all.mjs                                          # the full matrix
```

Each run gets its own workspace under `spike/runs/`, with the artifact, the full engine
event stream (`events.jsonl`), `summary.json`, and the final message.

## Key findings for the next phase

- **Supervise your own engine.** Spawn `opencode serve` on an ephemeral port, drain its
  stdout (an unread pipe silently freezes it), restart it on crash.
- **Poll for completion.** `session.idle` is not delivered; use
  `session.get().outcome`. Poll forms and permission requests too.
- **Watch for stalls.** Interrupt after ~4 minutes without progress.
- **Budget from tokens.** `session.cost` reads 0 on Go; compute from usage.
- **Keep workspaces clean.** Hide scaffolding (`_test.mjs`, screenshots) from the user.

Details and numbers: [`spike/evidence/EVIDENCE.md`](spike/evidence/EVIDENCE.md) ·
configuration to ship: [`spike/evidence/V0-DEFAULTS.md`](spike/evidence/V0-DEFAULTS.md).

## Roadmap

- **Phase 1 — shell:** desktop app, chat, workspace-per-conversation, friendly progress,
  artifact cards, settings (model, MCP, updates, API key).
- **Phase 2 — delivery:** shell-side launcher guarantee, artifact library, API-key prompts
  for the rare services that need one.
- **Phase 3 — hardening:** family testing, media tooling (ffmpeg), scraping, office formats.

## License

Not chosen yet. Until a license is added, all rights are reserved.
