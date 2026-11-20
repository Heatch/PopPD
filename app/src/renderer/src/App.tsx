import { useCallback, useEffect, useState } from "react"
import type { ChatSummary, EngineStatus, Question, Settings } from "../../shared/types"
import { Sidebar } from "./components/Sidebar"
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
  const [versions, setVersions] = useState<{ app: string; rules?: boolean; engine?: string }>({ app: "" })
  const [screen, setScreen] = useState<Screen>({ name: "home" })
  const [runs, setRuns] = useState<
    Record<string, { line: string; startedAt: number; detail?: string; reasoning?: string }>
  >({})
  const [questions, setQuestions] = useState<Record<string, Question>>({})
  const [appearance, setAppearance] = useState<"light" | "dark">("light")
  const [toast, setToast] = useState<{ text: string; undo?: () => Promise<void> } | null>(null)

  const refresh = useCallback(async () => {
    const state = await window.popd.getState()
    setSettings(state.settings)
    setEngine(state.engine)
    setChats(state.chats)
    setVersions(state.versions)
    setAppearance(state.appearance)
  }, [])

  useEffect(() => {
    void refresh()
    const clearRun = (chatId: string) => {
      setRuns((current) => {
        const next = { ...current }
        delete next[chatId]
        return next
      })
      setQuestions((current) => {
        const next = { ...current }
        delete next[chatId]
        return next
      })
    }
    const off = window.popd.onEvent((event) => {
      if (event.type === "engine-status") setEngine(event.status)
      if (event.type === "chats-changed") void window.popd.listChats().then(setChats)
      if (event.type === "open-chat") setScreen({ name: "chat", id: event.chatId })
      if (event.type === "chat-progress") {
        setRuns((current) => ({
          ...current,
          [event.chatId]: {
            line: event.line,
            detail: event.detail,
            reasoning: event.reasoning,
            startedAt: Date.now() - event.elapsedMs,
          },
        }))
      }
      if (event.type === "chat-question") {
        setQuestions((current) => ({ ...current, [event.chatId]: event.question }))
      }
      if (event.type === "theme-changed") setAppearance(event.appearance)
      if (event.type === "chat-done" || event.type === "chat-error" || event.type === "chat-stopped") {
        clearRun(event.chatId)
      }
    })
    return off
  }, [refresh])

  // The archive toast retires on its own, like a confirmation should.
  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(null), 9000)
    return () => clearTimeout(timer)
  }, [toast])

  // Theme comes from the main process: it knows what the OS actually is.
  useEffect(() => {
    document.documentElement.dataset.theme = appearance
  }, [appearance])

  // Settings are for the person who set PopPD up: no visible button.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.ctrlKey && event.shiftKey && (event.key === "," || event.code === "Comma")) {
        event.preventDefault()
        setScreen({ name: "settings" })
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  const startChat = useCallback(async (prompt: string) => {
    const title = prompt.trim().slice(0, 48) || "New idea"
    const chat = await window.popd.createChat(title)
    setChats(await window.popd.listChats())
    setScreen({ name: "chat", id: chat.id, initialPrompt: prompt })
  }, [])

  // Archive and Delete both remove the chat from the list.
  const forgetChat = useCallback((id: string) => {
    setChats((current) => current.filter((chat) => chat.id !== id))
    setRuns((current) => {
      const next = { ...current }
      delete next[id]
      return next
    })
    setQuestions((current) => {
      const next = { ...current }
      delete next[id]
      return next
    })
    setScreen((current) =>
      current.name === "chat" && current.id === id ? { name: "home" } : current,
    )
  }, [])

  // Archive is gentle: show what happened and offer to take it back.
  const archived = useCallback((chat: ChatSummary) => {
    setToast({
      text: `“${chat.title}” moved to PopPD Archive.`,
      undo: async () => {
        const result = await window.popd.restoreChat(chat.id)
        if (!result.ok) {
          setToast({ text: result.error ?? "Couldn't bring that chat back." })
          return
        }
        setChats(await window.popd.listChats())
        setToast(null)
      },
    })
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

  if (screen.name === "settings") {
    return (
      <div className="shell">
        <div className="main">
          <SettingsScreen
            settings={settings}
            versions={versions}
            onClose={() => setScreen({ name: "home" })}
            onSaved={refresh}
          />
        </div>
      </div>
    )
  }

  return (
    <div className="shell">
      <Sidebar
        chats={chats}
        activeChatId={screen.name === "chat" ? screen.id : null}
        runningChatIds={Object.keys(runs)}
        screen={screen.name}
        engine={engine}
        version={versions.app}
        onHome={() => setScreen({ name: "home" })}
        onLibrary={() => setScreen({ name: "library" })}
        onOpenChat={(id) => setScreen({ name: "chat", id })}
        onNewChat={() => setScreen({ name: "home" })}
        onChatRemoved={forgetChat}
        onArchived={archived}
        onSettings={() => setScreen({ name: "settings" })}
        onRestartEngine={() => void window.popd.restartEngine()}
      />

      <div className={`main ${screen.name === "chat" ? "chat" : ""}`}>
        {screen.name === "home" && <Home onStart={startChat} />}
        {screen.name === "library" && <Library onOpenChat={(id) => setScreen({ name: "chat", id })} />}
        {screen.name === "chat" && (
          <Chat
            chatId={screen.id}
            initialPrompt={screen.initialPrompt}
            initialRun={runs[screen.id]}
            initialQuestion={questions[screen.id]}
            onQuestionAnswered={(chatId) =>
              setQuestions((current) => {
                const next = { ...current }
                delete next[chatId]
                return next
              })
            }
            onBack={() => setScreen({ name: "home" })}
          />
        )}
      </div>

      {toast && (
        <div className="toast" role="status">
          <span className="toast-text">{toast.text}</span>
          {toast.undo && (
            <button className="btn link small" onClick={() => void toast.undo?.()}>
              Undo
            </button>
          )}
          <button className="toast-close" aria-label="Dismiss" onClick={() => setToast(null)}>
            ×
          </button>
        </div>
      )}
    </div>
  )
}
