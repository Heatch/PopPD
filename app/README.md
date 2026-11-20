# PopPD — desktop shell (Phase 1)

The app a non-technical person uses: one window, a chat, and finished things that open
with one click. It bundles its own OpenCode engine and keeps every developer surface out
of sight.

**Status: complete (shell + delivery, guardrails, settings/ops).** Chat, the cross-chat
library with thumbnails, layered guardrails, and the full settings surface are
implemented and covered by unit, integration, Electron e2e, and real-engine tests.

## What it does

1. First run: one masked key field, stored by the engine (`integration.connect.key`).
2. Home: "What's on your mind?" plus suggestion chips, with a left sidebar that
   groups chats by recency (pinned chats stay on top) and highlights the active one.
   Each chat has a visible "…" button and a right-click menu to open, pin, rename,
   archive (moved to `Documents/PopPD Archive`, with Undo) or delete (to the Recycle Bin).
3. Chat: a real conversation that can run over many turns. Users can just talk, ask
   questions or refine an idea; PopPD only builds when the request clearly asks for
   something. Replies are labelled (the person on the right, PopPD on the left) and each
   turn keeps its own answer. While working: a live clock, a click-to-expand thinking
   panel, a Stop button, one clarifying-question card, artifact cards with **Open** /
   **Show in folder**, a guided API-key dialog, a retry card, and a developer handoff
   card when needed.
4. **Your stuff**: every finished thing across chats, with real thumbnails (web pages
   are screenshot in a hidden window), filters by recency, and one-click open.
5. Settings: model, appearance, key (with a check), MCP manager, usage and estimated
   spend, storage + archive, notifications, updates, logs, diagnostics.

## Using it as the developer

Settings are **hidden** from the normal UI. Open them with **Ctrl+Shift+,** or by
**Shift-clicking the PopPD wordmark**. The theme follows the computer by default
(Settings → Appearance can force light or dark).

The agent writes deliverables into `%USERPROFILE%\PopPD\<chat name>\` (or
`Documents\PopPD` when Documents is a plain local folder). Cloud-synced folders such as
OneDrive are skipped, and an existing synced workspace is moved out once at startup,
because their file locks and watchers wedged the engine. The shell guarantees
`Open this.bat`, moves scaffolding into `_work/`, and auto-opens the main artifact.

## Guardrails

- **Constitution v1** (`resources/popd-rules.md`): plain language, no commands, never
  touch files outside the workspace, ask for keys through the dialog, three escalation
  cases only.
- **Engine permissions**: writes outside the workspace are denied, `.env`/credential
  reads are denied, destructive shell is denied. Everything inside the workspace stays
  autonomous.
- **Message sanitizer**: the spike's dev-speak detector runs on every final message;
  offending lines and code fences are stripped and logged in `logs/guardrails.log`.
- **Preflight**: a low-disk warning before a run starts.

## Reliability & safety

- **A run survives the window.** Closing the window while PopPD is working hides it
  to the tray; the task finishes and a notification brings you back. The machine is
  kept awake while it works.
- **A run survives a restart.** On launch, unfinished engine sessions are re-attached
  and delivered normally (launcher, library entry, notification).
- **Crash-safe indexes.** `settings.json`, `chats.json` and `library.json` are written
  atomically with a `.bak` fallback; a crash dialog offers a diagnostics export.
- **No shell interpolation.** Open/reveal use Electron's `shell` APIs, and the
  generated launcher escapes hostile filenames (percent signs, quotes, control chars).
- **Packaged CSP**: the production renderer runs under a Content-Security-Policy.
- **Clean deletes.** Removing or archiving a chat also removes its engine session, so
  the engine database does not grow forever.

## Architecture

```
app/
├─ src/main/
│  ├─ index.ts            window, lifecycle, single-instance lock
│  ├─ ipc.ts              typed IPC surface (invoke + events)
│  ├─ settings.ts         %APPDATA%\PopPD\settings.json
│  ├─ chats.ts            chat index, run loop, question/permission sweeps, watchdog
│  ├─ backend/
│  │  ├─ types.ts         the engine boundary (real + mock implement it)
│  │  ├─ opencode.ts      OpenCode client implementation
│  │  └─ mock.ts          scripted engine for UI tests and demos
│  ├─ engine/
│  │  ├─ supervisor.ts    spawn · drain · health · restart · config injection
│  │  ├─ config.ts        the PopPD config (absolute paths!)
│  │  ├─ persona.ts       rules-file check + "who are you" probe
│  │  └─ progress.ts      tool → plain-language line
│  └─ delivery/
│     ├─ workspace.ts     Documents\PopPD\<slug>, no reuse of non-empty folders
│     ├─ launcher.ts      Open this.bat guarantee, open, show in folder
│     └─ artifacts.ts     output detection and ordering
├─ src/preload/index.ts   contextBridge API (no Node in the renderer)
├─ src/renderer/          React screens: Onboarding · Home · Chat · Settings
└─ resources/             constitution, plugin, bundled engine (engine is gitignored)
```

### Engine handling (from the spike)

- Spawn `opencode serve --hostname 127.0.0.1 --port 0`, parse URL + password, keep
  **draining** stdout/stderr (an unread pipe freezes the engine), health-check every
  10 s, restart with a 3-per-5-minutes budget.
- Config is injected with `OPENCODE_CONFIG_CONTENT`; `instructions` and the plugin path
  are **absolute**. A relative instruction path is silently ignored by OpenCode — the
  persona probe catches that.
- Completion comes from `session.get().outcome`; the event stream is display-only.
- A 4-minute no-progress watchdog interrupts and offers a retry.
- Budget is computed from tokens (`session.cost` is always 0 on Go).

## Scripts

```bash
npm install
node scripts/prepare-engine.mjs   # copies the opencode binary into resources/engine
npm run dev                       # electron-vite dev
npm run build                     # production bundles in out/
npm run typecheck
npm test                          # unit tests
npm run test:integration          # real engine persona check (one small model call)
npm run test:e2e                  # Electron UI e2e (mock engine)
npm run package                   # unpacked build in dist/win-unpacked
npm run package:installer         # NSIS installer in dist/
```

## Releasing

```bash
node scripts/release.mjs --dry --version 0.2.0   # print every step, change nothing
node scripts/release.mjs --version 0.2.0         # build, tag, push, upload
```

It bumps the version, copies the engine, builds the NSIS installer, computes the
SHA-256, commits and tags `vX.Y.Z`, pushes, then creates a GitHub release (via `gh`
when available, otherwise it prints the upload steps). The engine version is pinned
per release and shown in Settings.

## Environment (tests and demos)
| Variable | Effect |
| --- | --- |
| `POPD_MOCK=1` | Use the scripted backend (no model calls) |
| `POPD_MOCK_SPEED=0.2` | Speed the mock up |
| `POPD_USER_DATA` / `POPD_DOCUMENTS` / `POPD_WORKSPACE` | Isolate settings, docs, workspace |
| `POPD_NO_OPEN=1` | Never launch external apps |
| `POPD_REAL=1` | Run the real-engine e2e spec |
| `POPD_STALL_MS` / `POPD_POLL_MS` | Watchdog tuning (used by tests) |
| `OPENCODE_BIN` | Engine binary override for packaging |

## Verification map

| Milestone | Covered by |
| --- | --- |
| M1 skeleton + engine | `tests/unit/config.test.ts`, integration persona test, supervisor in every e2e |
| M2 chat | e2e onboarding → chat → result; `tests/unit/chats.test.ts` (watchdog, sanitizer, API-key request) |
| M3 delivery | `tests/unit/launcher.test.ts` (web + non-web + marker + scaffold sweep), `tests/unit/delivery.test.ts`, e2e artifact + library |
| M4 settings + ops | e2e settings (MCP, usage, updates, logs), `tests/unit/config.test.ts`, diagnostics handler |
| M5 hardening | `npm run test:e2e` (dev + packaged), `POPD_REAL=1` real-engine run, workspace-escape guard |
| Essentials | `tests/unit/storage.test.ts` (atomic + backup), `tests/unit/errors.test.ts`, e2e tray/close + re-attach (unit), rename |

## Known limits (deliberate)

- Windows only; the installer is unsigned for now (SmartScreen warns once).
- The bundled engine makes the installer large (~250 MB).
- Self-update checks GitHub releases; publishing a release is still manual.
- MCP configuration is a developer-only screen (form + status; no OAuth wizard).
- English only.
