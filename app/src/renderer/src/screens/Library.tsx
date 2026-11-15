import { useEffect, useState } from "react"
import type { LibraryEntry } from "../../../shared/types"

const GLYPH: Record<string, string> = {
  web: "🌐",
  image: "🖼️",
  video: "🎬",
  audio: "🎧",
  pdf: "📄",
  sheet: "📊",
  slides: "📽️",
  doc: "📝",
  svg: "✒️",
  text: "📃",
  other: "📦",
}

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function dateLabel(ts: number): string {
  return new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric" })
}

export function Library({ onOpenChat }: { onOpenChat: (id: string) => void }) {
  const [entries, setEntries] = useState<LibraryEntry[]>([])
  const [busy, setBusy] = useState(true)

  const load = async () => {
    setBusy(true)
    try {
      setEntries(await window.popd.library())
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    void load()
    const off = window.popd.onEvent((event) => {
      if (event.type === "library-changed") void window.popd.library().then(setEntries)
    })
    return off
  }, [])

  return (
    <main className="page wide">
      <h1>Your stuff</h1>
      <p className="sub">Everything PopPD has made for you, newest first.</p>

      {busy && <div className="empty">Looking…</div>}
      {!busy && entries.length === 0 && (
        <div className="empty">Nothing yet. Make something and it will appear here.</div>
      )}

      <div className="library-grid">
        {entries.map((entry) => (
          <div className="library-card" key={entry.chatId}>
            <button
              className="thumb"
              onClick={() => (entry.main ? window.popd.openArtifact(entry.main.path) : onOpenChat(entry.chatId))}
              aria-label={entry.main ? `Open ${entry.main.name}` : entry.chatTitle}
            >
              {entry.thumb ? (
                <img src={entry.thumb} alt="" />
              ) : (
                <span className="glyph">{GLYPH[entry.main?.kind ?? "other"] ?? "📦"}</span>
              )}
            </button>
            <div className="library-body">
              <div className="title">{entry.main?.name ?? entry.chatTitle}</div>
              <div className="meta">
                {entry.chatTitle} · {dateLabel(entry.updatedAt)}
                {entry.main ? ` · ${humanSize(entry.main.bytes)}` : ""}
              </div>
              <div className="row" style={{ marginTop: 10 }}>
                {entry.main && (
                  <button className="btn small" onClick={() => void window.popd.openArtifact(entry.main!.path)}>
                    Open
                  </button>
                )}
                {entry.main && (
                  <button
                    className="btn ghost small"
                    onClick={() => void window.popd.showInFolder(entry.main!.path)}
                  >
                    Show in folder
                  </button>
                )}
                <button className="btn link small" onClick={() => onOpenChat(entry.chatId)}>
                  Chat
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </main>
  )
}
