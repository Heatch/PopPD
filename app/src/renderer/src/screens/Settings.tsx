import { useEffect, useState } from "react"
import type {
  McpServerInfo,
  ModelOption,
  Settings,
  UpdateState,
  UsageEntry,
  WorkspaceStat,
} from "../../../shared/types"

function humanBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`
}

function humanTokens(value: number): string {
  if (value < 1000) return String(value)
  if (value < 1_000_000) return `${(value / 1000).toFixed(1)}k`
  return `${(value / 1_000_000).toFixed(2)}M`
}

export function SettingsScreen({
  settings,
  versions,
  onClose,
  onSaved,
}: {
  settings: Settings
  versions: { app: string; rules?: boolean; engine?: string }
  onClose: () => void
  onSaved: () => Promise<void> | void
}) {
  const [models, setModels] = useState<ModelOption[]>([])
  const [key, setKey] = useState("")
  const [keyStatus, setKeyStatus] = useState<{ ok: boolean; text: string } | null>(null)
  const [keyCheck, setKeyCheck] = useState<string | null>(null)
  const [persona, setPersona] = useState<{ ok: boolean; text: string } | null>(null)
  const [diagnostics, setDiagnostics] = useState<string | null>(null)
  const [servers, setServers] = useState<McpServerInfo[]>([])
  const [newMcp, setNewMcp] = useState({ name: "", type: "remote", value: "" })
  const [mcpNote, setMcpNote] = useState<string | null>(null)
  const [usage, setUsage] = useState<UsageEntry[]>([])
  const [stats, setStats] = useState<{ root: string; total: number; chats: WorkspaceStat[] } | null>(null)
  const [logs, setLogs] = useState<{ engine: string; plugin: string } | null>(null)
  const [showLogs, setShowLogs] = useState(false)
  const [update, setUpdate] = useState<UpdateState>({ status: "idle" })
  const [busy, setBusy] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const reload = async () => {
    const [modelList, mcp, usageRows, storage] = await Promise.all([
      window.popd.listModels().catch(() => []),
      window.popd.mcpList().catch(() => []),
      window.popd.usage().catch(() => []),
      window.popd.workspaceStats().catch(() => null),
    ])
    setModels(modelList)
    setServers(mcp)
    setUsage(usageRows)
    setStats(storage)
  }

  useEffect(() => {
    void reload()
    void window.popd.updates().then(setUpdate)
    const off = window.popd.onEvent((event) => {
      if (event.type === "update-state") setUpdate(event.state)
    })
    return off
  }, [])

  const save = async (patch: Partial<Settings>) => {
    await window.popd.saveSettings(patch)
    await onSaved()
    await reload()
  }

  const saveKey = async () => {
    if (!key.trim()) return
    setBusy("key")
    setKeyStatus(null)
    try {
      const result = await window.popd.connectKey(key.trim())
      setKeyStatus({
        ok: result.ok,
        text: result.ok ? "Saved. You're all set." : result.error ?? "That key didn't work.",
      })
      if (result.ok) setKey("")
    } finally {
      setBusy(null)
    }
  }

  const checkKey = async () => {
    setBusy("check")
    setKeyCheck(null)
    try {
      const result = await window.popd.checkKey()
      setKeyCheck(`${result.ok ? "✓ " : "✗ "}${result.text}`)
    } finally {
      setBusy(null)
    }
  }

  const addServer = async () => {
    const name = newMcp.name.trim()
    if (!name || !newMcp.value.trim()) return
    const entry =
      newMcp.type === "remote"
        ? { enabled: true, url: newMcp.value.trim() }
        : { enabled: true, command: newMcp.value.trim().split(/\s+/) }
    await save({
      allowMcp: true,
      mcpServers: { ...settings.mcpServers, [name]: entry },
    })
    setNewMcp({ name: "", type: "remote", value: "" })
    setMcpNote("Server added. The builder restarted to apply it.")
  }

  const toggleServer = async (name: string, enabled: boolean) => {
    const existing = settings.mcpServers[name] ?? { enabled }
    await save({
      allowMcp: settings.allowMcp || enabled,
      mcpServers: { ...settings.mcpServers, [name]: { ...existing, enabled } },
    })
  }

  const removeServer = async (name: string) => {
    const next = { ...settings.mcpServers }
    delete next[name]
    await save({ mcpServers: next })
    setMcpNote(`${name} removed.`)
  }

  const checkUpdates = async () => {
    setBusy("updates")
    try {
      setUpdate(await window.popd.checkUpdates())
    } finally {
      setBusy(null)
    }
  }

  const downloadUpdate = async () => {
    setBusy("updates")
    try {
      setUpdate(await window.popd.downloadUpdate())
    } finally {
      setBusy(null)
    }
  }

  const exportDiagnostics = async () => {
    setBusy("diagnostics")
    try {
      setDiagnostics(await window.popd.exportDiagnostics())
    } finally {
      setBusy(null)
    }
  }

  const loadLogs = async () => {
    setLogs(await window.popd.logs())
    setShowLogs(true)
  }

  const archive = async (chatId: string, title: string) => {
    if (!window.confirm(`Move "${title}" to the archive folder? You can still open the files there.`)) return
    const result = await window.popd.archiveChat(chatId)
    setNotice(result.ok ? `Archived to ${result.path}` : result.error ?? "Could not archive that chat.")
    await onSaved()
    await reload()
  }

  const totalCost = usage.reduce((sum, entry) => sum + entry.costUsd, 0)

  const displayServers = [
    ...servers,
    ...Object.entries(settings.mcpServers)
      .filter(([name]) => !servers.some((server) => server.name === name))
      .map(([name, config]) => ({
        name,
        status: config.enabled ? "configured" : "disabled",
        enabled: config.enabled,
      })),
  ]

  return (
    <main className="page">
      <div className="row" style={{ marginBottom: 16 }}>
        <button className="btn ghost small" onClick={onClose}>
          ← Back
        </button>
        <span className="spacer" />
        <span className="muted">
          PopPD {versions.app}
          {versions.engine ? ` · builder ${versions.engine}` : ""}
        </span>
      </div>

      <h1>Settings</h1>
      <p className="sub">For whoever set PopPD up. Nothing here is needed for everyday use.</p>

      <section className="setting card">
        <h2>Appearance</h2>
        <p className="desc">Follows your computer by default.</p>
        <div className="row">
          {(["system", "light", "dark"] as const).map((theme) => (
            <button
              key={theme}
              className="chip"
              aria-pressed={settings.theme === theme}
              onClick={() => void save({ theme })}
            >
              {theme === "system" ? "Match computer" : theme === "light" ? "Light" : "Dark"}
            </button>
          ))}
        </div>
      </section>

      <section className="setting card">
        <h2>Model</h2>
        <p className="desc">Only the models included with your PopPD account are listed.</p>
        <div className="model-list">
          {models.length === 0 && <div className="muted">No models listed (is the builder running?).</div>}
          {models.map((model) => {
            const active = settings.model === `${model.providerID}/${model.id}`
            return (
              <button
                key={`${model.providerID}/${model.id}`}
                className="model"
                aria-pressed={active}
                onClick={() => void save({ model: `${model.providerID}/${model.id}` })}
              >
                <span className="name">{model.name}</span>
                <span className="hint">{model.hint ?? ""}</span>
              </button>
            )
          })}
        </div>
      </section>

      <section className="setting card">
        <h2>Your key</h2>
        <p className="desc">Replace the key PopPD uses. It is stored by the builder, never here.</p>
        <div className="row">
          <input
            className="input"
            style={{ flex: 1 }}
            type="password"
            placeholder="Paste a new key"
            value={key}
            onChange={(event) => setKey(event.target.value)}
          />
          <button className="btn" disabled={!key.trim() || busy === "key"} onClick={() => void saveKey()}>
            {busy === "key" ? "Saving…" : "Save"}
          </button>
          <button className="btn ghost" disabled={busy === "check"} onClick={() => void checkKey()}>
            {busy === "check" ? "Checking…" : "Check key"}
          </button>
        </div>
        {keyStatus && <p className={`status-line ${keyStatus.ok ? "ok" : "bad"}`}>{keyStatus.text}</p>}
        {keyCheck && <p className="status-line">{keyCheck}</p>}
      </section>

      <section className="setting card">
        <h2>MCP servers</h2>
        <p className="desc">
          Advanced. Off by default so the builder stays focused. Add a server, then enable it.
        </p>
        <label className="row" style={{ marginBottom: 12 }}>
          <input
            type="checkbox"
            checked={settings.allowMcp}
            onChange={(event) => void save({ allowMcp: event.target.checked })}
          />
          Allow MCP servers
        </label>

        <div className="server-list">
          {displayServers.length === 0 && <div className="muted">No servers configured.</div>}
          {displayServers.map((server) => {
            const managed = Boolean(settings.mcpServers[server.name])
            return (
              <div className="server-row" key={server.name}>
                <span className={`led ${server.status === "connected" ? "on" : ""}`} />
                <span className="name">{server.name}</span>
                <span className="muted">{server.status}</span>
                <span className="spacer" />
                {managed ? (
                  <>
                    <button
                      className="btn ghost small"
                      onClick={() => void toggleServer(server.name, !settings.mcpServers[server.name]?.enabled)}
                    >
                      {settings.mcpServers[server.name]?.enabled ? "Disable" : "Enable"}
                    </button>
                    <button className="btn link small" onClick={() => void removeServer(server.name)}>
                      Remove
                    </button>
                  </>
                ) : (
                  <span className="muted">managed by config</span>
                )}
              </div>
            )
          })}
        </div>

        <div className="row" style={{ marginTop: 14 }}>
          <input
            className="input"
            style={{ width: 150 }}
            placeholder="name"
            value={newMcp.name}
            onChange={(event) => setNewMcp((current) => ({ ...current, name: event.target.value }))}
          />
          <select
            className="input"
            style={{ width: 110 }}
            value={newMcp.type}
            onChange={(event) => setNewMcp((current) => ({ ...current, type: event.target.value }))}
          >
            <option value="remote">remote</option>
            <option value="local">local</option>
          </select>
          <input
            className="input"
            style={{ flex: 1 }}
            placeholder={newMcp.type === "remote" ? "https://…/mcp" : "command args"}
            value={newMcp.value}
            onChange={(event) => setNewMcp((current) => ({ ...current, value: event.target.value }))}
          />
          <button className="btn ghost" onClick={() => void addServer()}>
            Add
          </button>
        </div>
        {mcpNote && <p className="status-line">{mcpNote}</p>}
      </section>

      <section className="setting card">
        <h2>Usage</h2>
        <p className="desc">
          Estimated spend: <strong>${totalCost.toFixed(2)}</strong> across {usage.length} chat
          {usage.length === 1 ? "" : "s"} on the current model.
        </p>
        <div className="usage-list">
          {usage.length === 0 && <div className="muted">No usage yet.</div>}
          {usage.slice(0, 10).map((entry) => (
            <div className="usage-row" key={entry.chatId}>
              <span className="name">{entry.title}</span>
              <span className="spacer" />
              <span className="muted">
                {humanTokens(entry.input)} in / {humanTokens(entry.output)} out
              </span>
              <span className="cost">${entry.costUsd.toFixed(3)}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="setting card">
        <h2>Folder & storage</h2>
        <p className="desc">
          Finished things are saved here, on this computer. Cloud folders like OneDrive are
          avoided because they can make builds stall.
        </p>
        <div className="row">
          <code className="muted" style={{ fontSize: 13 }}>
            {settings.workspaceRoot}
          </code>
          <span className="spacer" />
          <button className="btn ghost small" onClick={() => void window.popd.openFolder(settings.workspaceRoot)}>
            Open folder
          </button>
        </div>
        {stats && (
          <p className="status-line">
            Using {humanBytes(stats.total)} across {stats.chats.length} workspaces.
          </p>
        )}
        <div className="usage-list" style={{ marginTop: 10 }}>
          {stats?.chats.map((chat) => (
            <div className="usage-row" key={chat.chatId}>
              <span className="name">{chat.title}</span>
              <span className="spacer" />
              <span className="muted">{humanBytes(chat.bytes)}</span>
              <button className="btn link small" onClick={() => void archive(chat.chatId, chat.title)}>
                Archive
              </button>
            </div>
          ))}
        </div>
      </section>

      <section className="setting card">
        <h2>While it works</h2>
        <label className="row">
          <input
            type="checkbox"
            checked={settings.notifications}
            onChange={(event) => void save({ notifications: event.target.checked })}
          />
          Show a notification when something is ready
        </label>
        <label className="row" style={{ marginTop: 10 }}>
          <input
            type="checkbox"
            checked={settings.autoOpen}
            onChange={(event) => void save({ autoOpen: event.target.checked })}
          />
          Open the result automatically
        </label>
      </section>

      <section className="setting card">
        <h2>Setup check</h2>
        <p className="desc">Ask the builder to introduce itself. It should say it is PopPD.</p>
        <div className="row">
          <button className="btn ghost" disabled={busy === "persona"} onClick={() => void runPersona(setBusy, setPersona, busy)}>
            {busy === "persona" ? "Checking…" : "Run check"}
          </button>
          {versions.rules === false && <span className="status-line bad">Rules file missing.</span>}
        </div>
        {persona && (
          <p className={`status-line ${persona.ok ? "ok" : "bad"}`}>
            {persona.ok ? "Looks right: " : "Unexpected answer: "}
            {persona.text.slice(0, 240)}
          </p>
        )}
      </section>

      <section className="setting card">
        <h2>Updates</h2>
        <p className="desc">The builder updates together with PopPD.</p>
        <div className="row">
          {(update.status === "idle" || update.status === "none" || update.status === "error") && (
            <button className="btn ghost" disabled={busy === "updates"} onClick={() => void checkUpdates()}>
              {busy === "updates" ? "Checking…" : "Check for updates"}
            </button>
          )}
          {update.status === "checking" && <span className="muted">Checking…</span>}
          {update.status === "available" && (
            <button className="btn" onClick={() => void downloadUpdate()}>
              Download {update.version ? `v${update.version}` : "update"}
            </button>
          )}
          {update.status === "downloading" && (
            <span className="muted">Downloading… {update.percent ?? 0}%</span>
          )}
          {update.status === "ready" && (
            <button className="btn" onClick={() => void window.popd.installUpdate()}>
              Restart and install
            </button>
          )}
          {update.status === "none" && <span className="muted">You're up to date.</span>}
          {update.status === "error" && <span className="status-line bad">{update.message}</span>}
          {update.message && update.status !== "error" && <span className="muted">{update.message}</span>}
        </div>
      </section>

      <section className="setting card">
        <h2>Logs</h2>
        <p className="desc">For when something needs investigating.</p>
        <div className="row">
          <button className="btn ghost" onClick={() => void loadLogs()}>
            {showLogs ? "Reload logs" : "Show logs"}
          </button>
          {showLogs && (
            <button className="btn link small" onClick={() => setShowLogs(false)}>
              Hide
            </button>
          )}
        </div>
        {showLogs && logs && (
          <div className="logs">
            <div className="muted">Engine</div>
            <pre>{logs.engine.slice(-8000) || "(no engine logs yet)"}</pre>
            <div className="muted">Plugin</div>
            <pre>{logs.plugin.slice(-4000) || "(no plugin logs yet)"}</pre>
          </div>
        )}
      </section>

      <section className="setting card">
        <h2>Diagnostics</h2>
        <p className="desc">A file with logs and settings, for when something needs investigating.</p>
        <div className="row">
          <button className="btn ghost" disabled={busy === "diagnostics"} onClick={() => void exportDiagnostics()}>
            {busy === "diagnostics" ? "Writing…" : "Export"}
          </button>
          {diagnostics && (
            <button className="btn ghost small" onClick={() => void window.popd.showInFolder(diagnostics)}>
              Show file
            </button>
          )}
        </div>
        {diagnostics && <p className="status-line">{diagnostics}</p>}
      </section>

      {notice && <p className="status-line ok">{notice}</p>}
    </main>
  )
}

async function runPersona(
  setBusy: (value: string | null) => void,
  setPersona: (value: { ok: boolean; text: string } | null) => void,
  current: string | null,
) {
  if (current) return
  setBusy("persona")
  setPersona(null)
  try {
    setPersona(await window.popd.testPersona())
  } finally {
    setBusy(null)
  }
}
