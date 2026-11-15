# PopPD v0 defaults (spike output)

Everything here was exercised by the spike harness. These are the values Phase 1
should ship; the Settings screen owns them, the user never sees them.

## Model

- Pinned default: `opencode-go/deepseek-v4.1-flash`
- Provider: OpenCode Go (`opencode-go`), OpenAI-compatible endpoint
- Price observed on models.dev: $0.15 / M input, $0.60 / M output
- Model list for the Settings picker: `https://opencode.ai/inference/go/v1/models`
  (filter to `opencode-go`); the picker is the only place a model can be changed.
- Do not surface the provider name in the product UI.

## Config file (what Settings writes)

Location: `~/.config/opencode/opencode.jsonc` (global). Project configs are not used
by PopPD; a session's workspace only supplies the working directory.

**Important (verified in the spike):** relative paths inside `instructions` resolve
against the *session workspace*, not the config file, and a missing file is dropped
silently — the agent then behaves like plain OpenCode. PopPD must write **absolute**
paths for `instructions`. Plugin packages resolved relative to the engine's working
directory in the spike; use absolute paths for those too, so behaviour does not depend
on where the engine was started.

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "model": "opencode-go/deepseek-v4.1-flash",
  "default_agent": "pop",
  "instructions": ["C:/Program Files/PopPD/resources/popd-rules.md"],
  "plugins": [{ "package": "C:/Program Files/PopPD/resources/popd-plugin" }],
  "agents": {
    "plan": { "disabled": true },
    "build": { "hidden": true },
    "pop": {
      "mode": "primary",
      "description": "PopPD: turns everyday requests into finished, openable results"
    }
  },
  "permissions": [
    { "action": "*", "resource": "*", "effect": "allow" },
    { "action": "read", "resource": "*.env", "effect": "allow" },
    { "action": "read", "resource": "*.env.*", "effect": "allow" }
  ],
  "policies": [{ "action": "mcp.use", "resource": "*", "effect": "deny" }]
}
```

Notes verified in the spike:

- The `permissions` base policy is already allow-everything except `.env` reads;
  the two `.env` rules above make autonomy unconditional. Zero permission prompts
  were observed across all runs.
- `agents.plan.disabled` removes the Plan agent entirely (`agent.get` → "Agent not
  found"), and `agents.build.hidden` hides the developer agent from the picker.
- `default_agent: "pop"` makes the PopPD agent the only visible primary.
- `policies[].mcp.use = deny` stops inherited MCP servers from connecting, which
  keeps the agent's tool surface small.
- Config changes are hot-reloaded; no restart is needed after Settings writes.

## Key storage

The engine already supports non-interactive credential entry. Three verified paths:

- **SDK (preferred):** `client.integration.connect.key({ integrationID: "opencode-go", key })`.
  The catalog lists `opencode-go` with a `key` method, plus an `env` method that reads
  `OPENCODE_API_KEY`.
- **CLI:** `opencode auth login opencode-go --method key --answer <field>=<value>`
  (repeat `--answer`), or `opencode auth import <file>` with `auth export` JSON.
- **Environment:** `OPENCODE_API_KEY` for development machines.

`~/.local/share/opencode/auth.json` holds provider entries (the machine used for the
spike had `opencode-go` and `deepseek`). The Settings screen should call the first
path with the key the user pastes, and never display the key again. No key material
is stored in the PopPD config file.

## Updates

- OpenCode's own update behavior is global-only: `update: "notify" | "auto" | "disable"`.
  PopPD should set `"notify"` and drive installation from the Settings screen
  (`opencode upgrade`) so the user never sees a terminal.
- The PopPD shell itself updates through its desktop framework's updater
  (electron-updater / Tauri updater, decided in Phase 1).
- The bundled engine version is pinned per PopPD release; the SDK is generated from
  the same OpenAPI contract, so version skew is detectable at build time.

## Spike configuration deviations

- The spike used a project config under `spike/` instead of the global file so it
  would not disturb the developer's machine. The config shape is identical; only the
  location differs.
- The spike used the machine's existing engine service. PopPD will spawn its own
  (`opencode serve --port 0`-style private instance, or the SDK's service helper) and
  pass the config content at startup.
- MCP servers inherited from the developer's global config were denied by policy in
  the spike. In the product, Settings will add/remove/enable servers explicitly.

## Delivered files

| File | Role |
| --- | --- |
| `opencode.jsonc` | Working config used by the spike |
| `instructions/popd-rules.md` | Constitution v0 |
| `popd-plugin/server.ts` | Last-mile tools + escalation |
| `driver.mjs` | Headless run harness (production-shaped) |
| `lint.mjs` | Developer-speak detector |
| `run-all.mjs` | Experiment matrix + evidence writer |
