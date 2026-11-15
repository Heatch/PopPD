import { useCallback, useEffect, useState } from "react"
import type { ChatSummary, EngineStatus, Settings } from "../../shared/types"
import { Chat } from "./screens/Chat"
import { Home } from "./screens/Home"
import { Library } from "./screens/Library"
import { SettingsScreen } from "./screens/Settings"
import { Onboarding } from "./screens/Onboarding"

type Screen =
  | { name: "home" }
  | { name: "chat"; id: string; initialPrompt?: string }
  | { name: "settings" }
  | { name: "library" }

export function App() {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [engine, setEngine] = useState<EngineStatus>("starting")
  const [chats, setChats] = useState<ChatSummary[]>([])
  const [versions, setVersions] = useState<{ app: string; rules?: boolean }>({ app: "" })
  const [screen, setScreen] = useState<Screen>({ name: "home" })

  const refresh = useCallback(async () => {
    const state = await window.popd.getState()
    setSettings(state.settings)
    setEngine(state.engine)
    setChats(state.chats)
    setVersions(state.versions)
  }, [])

  useEffect(() => {
    void refresh()
    const off = window.popd.onEvent((event) => {
      if (event.type === "engine-status") setEngine(event.status)
      if (event.type === "chats-changed") void window.popd.listChats().then(setChats)
      if (event.type === "open-chat") setScreen({ name: "chat", id: event.chatId })
    })
    return off
  }, [refresh])

  const startChat = useCallback(async (prompt: string) => {
    const title = prompt.trim().slice(0, 48) || "New idea"
    const chat = await window.popd.createChat(title)
    setChats(await window.popd.listChats())
    setScreen({ name: "chat", id: chat.id, initialPrompt: prompt })
  }, [])

  if (!settings) {
    return <div className="boot">Starting PopPD…</div>
  }

  if (!settings.onboarded) {
    return (
      <Onboarding
        onDone={async () => {
          await refresh()
          setScreen({ name: "home" })
        }}
      />
    )
  }

  if (screen.name === "chat") {
    return (
      <Chat
        chatId={screen.id}
        initialPrompt={screen.initialPrompt}
        engine={engine}
        onBack={() => setScreen({ name: "home" })}
        onRestartEngine={() => window.popd.restartEngine()}
      />
    )
  }

  return (
    <div className="app">
      <header className="topbar">
        <button
          className="wordmark wordmark-button"
          onClick={() => setScreen({ name: "home" })}
          aria-label="PopPD home"
        >
          <span className="dot" />
          PopPD
        </button>
        <div className="topbar-actions">
          <EnginePill engine={engine} onRestart={() => window.popd.restartEngine()} />
          <button
            className={`btn ghost small ${screen.name === "library" ? "active" : ""}`}
            onClick={() => setScreen({ name: "library" })}
          >
            Your stuff
          </button>
          <button
            className={`btn ghost small ${screen.name === "settings" ? "active" : ""}`}
            onClick={() => setScreen({ name: "settings" })}
          >
            Settings
          </button>
        </div>
      </header>

      {screen.name === "settings" && (
        <SettingsScreen
          settings={settings}
          versions={versions}
          onClose={() => setScreen({ name: "home" })}
          onSaved={refresh}
        />
      )}
      {screen.name === "library" && (
        <Library onOpenChat={(id) => setScreen({ name: "chat", id })} />
      )}
      {screen.name === "home" && (
        <Home
          chats={chats}
          onOpenChat={(id) => setScreen({ name: "chat", id })}
          onStart={startChat}
          onOpenLibrary={() => setScreen({ name: "library" })}
        />
      )}
    </div>
  )
}

function EnginePill({ engine, onRestart }: { engine: EngineStatus; onRestart: () => void }) {
  if (engine === "ready") return null
  const label =
    engine === "starting" ? "Warming up…" : engine === "error" ? "The builder stopped" : "Starting…"
  return (
    <span className={`engine-pill ${engine}`}>
      <span className="led" />
      {label}
      {engine === "error" && (
        <button className="btn link small" onClick={onRestart}>
          Restart
        </button>
      )}
    </span>
  )
}
