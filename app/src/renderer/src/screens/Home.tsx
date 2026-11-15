import { useState } from "react"
import type { ChatSummary } from "../../../shared/types"

function relative(ts: number): string {
  const diff = Date.now() - ts
  const minutes = Math.round(diff / 60_000)
  if (minutes < 1) return "just now"
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} h ago`
  const days = Math.round(hours / 24)
  if (days === 1) return "yesterday"
  return new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric" })
}

export function Home({
  chats,
  onOpenChat,
  onStart,
  onOpenLibrary,
}: {
  chats: ChatSummary[]
  onOpenChat: (id: string) => void
  onStart: (prompt: string) => Promise<void> | void
  onOpenLibrary: () => void
}) {
  const [prompt, setPrompt] = useState("")
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    if (!prompt.trim() || busy) return
    setBusy(true)
    try {
      await onStart(prompt.trim())
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="container">
      <section className="hero">
        <h1>What should we make today?</h1>
        <p>
          Say it in your own words. PopPD figures out the technical bits and hands you something you
          can open with one click.
        </p>
      </section>

      <section className="prompt-card">
        <textarea
          autoFocus
          value={prompt}
          placeholder="A timer to help me focus… a spreadsheet for my expenses… a little website for my club…"
          onChange={(event) => setPrompt(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault()
              void submit()
            }
          }}
        />
        <div className="prompt-actions">
          <span className="hint">It may take a few minutes. You can leave it running.</span>
          <button className="btn" disabled={!prompt.trim() || busy} onClick={() => void submit()}>
            Make it →
          </button>
        </div>
      </section>

      <section>
        <div className="row" style={{ marginBottom: 14 }}>
          <h2 className="section-title" style={{ margin: 0 }}>
            Recent
          </h2>
          <span className="spacer" />
          <button className="btn link small" onClick={onOpenLibrary}>
            See everything →
          </button>
        </div>
        {chats.length === 0 ? (
          <div className="empty">Nothing yet — the first thing you make will appear here.</div>
        ) : (
          <div className="chat-list">
            {chats.map((chat) => (
              <button key={chat.id} className="chat-card" onClick={() => onOpenChat(chat.id)}>
                <span style={{ fontSize: 20 }}>✨</span>
                <span style={{ minWidth: 0 }}>
                  <div className="title">{chat.title}</div>
                  <div className="meta">{relative(chat.updatedAt)}</div>
                </span>
                <span className="spacer" />
                <span className="muted">→</span>
              </button>
            ))}
          </div>
        )}
      </section>
    </main>
  )
}
