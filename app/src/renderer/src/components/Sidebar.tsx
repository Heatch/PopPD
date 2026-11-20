import { useEffect, useState } from "react"
import type { MouseEvent } from "react"
import type { ChatSummary, EngineStatus } from "../../../shared/types"

function groupChats(chats: ChatSummary[]) {
  const now = Date.now()
  const day = 24 * 60 * 60 * 1000
  const pinned: ChatSummary[] = []
  const today: ChatSummary[] = []
  const week: ChatSummary[] = []
  const older: ChatSummary[] = []
  for (const chat of chats) {
    if (chat.pinned) {
      pinned.push(chat)
      continue
    }
    const age = now - chat.updatedAt
    if (age < day) today.push(chat)
    else if (age < 7 * day) week.push(chat)
    else older.push(chat)
  }
  return [
    { label: "Pinned", chats: pinned },
    { label: "Today", chats: today },
    { label: "Previous 7 days", chats: week },
    { label: "Older", chats: older },
  ].filter((group) => group.chats.length > 0)
}

const MENU_WIDTH = 164
const MENU_HEIGHT = 200

type MenuState = { chat: ChatSummary; left: number; top?: number; bottom?: number }

export function Sidebar({
  chats,
  activeChatId,
  runningChatIds,
  screen,
  engine,
  version,
  onHome,
  onLibrary,
  onOpenChat,
  onNewChat,
  onChatRemoved,
  onArchived,
  onSettings,
  onRestartEngine,
}: {
  chats: ChatSummary[]
  activeChatId: string | null
  runningChatIds: string[]
  screen: "home" | "chat" | "library"
  engine: EngineStatus
  version: string
  onHome: () => void
  onLibrary: () => void
  onOpenChat: (id: string) => void
  onNewChat: () => void
  onChatRemoved: (id: string) => void
  onArchived: (chat: ChatSummary) => void
  onSettings: () => void
  onRestartEngine: () => void
}) {
  const groups = groupChats(chats)
  const [menu, setMenu] = useState<MenuState | null>(null)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameDraft, setRenameDraft] = useState("")
  const [confirming, setConfirming] = useState<ChatSummary | null>(null)

  useEffect(() => {
    if (!menu) return
    const close = () => setMenu(null)
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenu(null)
    }
    window.addEventListener("click", close)
    window.addEventListener("resize", close)
    window.addEventListener("scroll", close, true)
    window.addEventListener("keydown", onKey)
    return () => {
      window.removeEventListener("click", close)
      window.removeEventListener("resize", close)
      window.removeEventListener("scroll", close, true)
      window.removeEventListener("keydown", onKey)
    }
  }, [menu])

  useEffect(() => {
    if (!confirming) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setConfirming(null)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [confirming])

  const place = (chat: ChatSummary, x: number, y: number, anchorRight?: number): MenuState => {
    const left = Math.max(8, Math.min(anchorRight ?? x, window.innerWidth - MENU_WIDTH - 8))
    const openUp = window.innerHeight - y < MENU_HEIGHT + 12
    return openUp
      ? { chat, left, bottom: window.innerHeight - y + 4 }
      : { chat, left, top: y + 4 }
  }

  const openFromButton = (chat: ChatSummary, event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation()
    if (menu?.chat.id === chat.id) {
      setMenu(null)
      return
    }
    const rect = event.currentTarget.getBoundingClientRect()
    setMenu(place(chat, rect.right, rect.bottom, rect.right - MENU_WIDTH))
  }

  const openAtPointer = (chat: ChatSummary, event: MouseEvent) => {
    event.preventDefault()
    event.stopPropagation()
    setMenu(place(chat, event.clientX, event.clientY))
  }

  const startRename = (chat: ChatSummary) => {
    setMenu(null)
    setRenamingId(chat.id)
    setRenameDraft(chat.title)
  }

  const saveRename = async (id: string) => {
    const title = renameDraft.trim()
    setRenamingId(null)
    if (title) await window.popd.renameChat(id, title)
  }

  const archive = async (chat: ChatSummary) => {
    setMenu(null)
    const result = await window.popd.archiveChat(chat.id)
    onChatRemoved(chat.id)
    if (result.ok) onArchived(chat)
  }

  const remove = async (chat: ChatSummary) => {
    setConfirming(null)
    await window.popd.deleteChat(chat.id)
    onChatRemoved(chat.id)
  }

  return (
    <aside className="sidebar">
      <div className="sidebar-head">
        <button
          className="wordmark wordmark-button"
          aria-label="PopPD home"
          title="Home"
          onClick={(event) => (event.shiftKey ? onSettings() : onHome())}
        >
          <span className="dot" />
          PopPD
        </button>
      </div>

      <button className="btn new-chat" onClick={onNewChat}>
        + New chat
      </button>

      <nav className="side-nav">
        <button aria-label="Home" className={`side-item ${screen === "home" ? "active" : ""}`} onClick={onHome}>
          <span className="icon">⌂</span>
          Home
        </button>
        <button
          aria-label="Your stuff"
          className={`side-item ${screen === "library" ? "active" : ""}`}
          onClick={onLibrary}
        >
          <span className="icon">▦</span>
          Your stuff
        </button>
      </nav>

      <div className="side-chats">
        {groups.length === 0 && <div className="side-empty">Your chats will appear here.</div>}
        {groups.map((group) => (
          <div key={group.label}>
            <div className="side-section">{group.label}</div>
            {group.chats.map((chat) => (
              <div
                className="side-chat-row"
                key={chat.id}
                onContextMenu={renamingId === chat.id ? undefined : (event) => openAtPointer(chat, event)}
              >
                {renamingId === chat.id ? (
                  <input
                    className="side-rename"
                    aria-label="Chat name"
                    autoFocus
                    value={renameDraft}
                    onClick={(event) => event.stopPropagation()}
                    onChange={(event) => setRenameDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") void saveRename(chat.id)
                      if (event.key === "Escape") setRenamingId(null)
                    }}
                    onBlur={() => {
                      if (renamingId === chat.id) void saveRename(chat.id)
                    }}
                  />
                ) : (
                  <>
                    <button
                      className={`side-chat ${chat.id === activeChatId ? "active" : ""}`}
                      title={`${chat.title} — right-click for options`}
                      onClick={() => onOpenChat(chat.id)}
                      onDoubleClick={() => startRename(chat)}
                    >
                      <span className="side-chat-title">{chat.title}</span>
                      {runningChatIds.includes(chat.id) && <span className="run-dot" />}
                    </button>
                    <button
                      className="chat-options"
                      aria-label={`Options for ${chat.title}`}
                      aria-haspopup="menu"
                      aria-expanded={menu?.chat.id === chat.id}
                      onClick={(event) => openFromButton(chat, event)}
                    >
                      ⋯
                    </button>
                  </>
                )}
              </div>
            ))}
          </div>
        ))}
      </div>

      <div className="side-footer">
        {engine !== "ready" ? (
          <span className={`engine-pill ${engine}`}>
            <span className="led" />
            {engine === "error" ? "Builder stopped" : "Warming up…"}
            {engine === "error" && (
              <button
                className="btn link small"
                onClick={onRestartEngine}
                style={{ padding: "0 0 0 4px" }}
              >
                Restart
              </button>
            )}
          </span>
        ) : (
          <span>PopPD {version}</span>
        )}
      </div>

      {menu && (
        <div
          className="chat-menu"
          role="menu"
          aria-label={`Options for ${menu.chat.title}`}
          style={{ left: menu.left, top: menu.top, bottom: menu.bottom }}
          onClick={(event) => event.stopPropagation()}
          onContextMenu={(event) => event.preventDefault()}
        >
          <button role="menuitem" onClick={() => { setMenu(null); onOpenChat(menu.chat.id) }}>
            Open
          </button>
          <button
            role="menuitem"
            onClick={() => {
              setMenu(null)
              void window.popd.pinChat(menu.chat.id, !menu.chat.pinned)
            }}
          >
            {menu.chat.pinned ? "Unpin" : "Pin to top"}
          </button>
          <button role="menuitem" onClick={() => startRename(menu.chat)}>
            Rename
          </button>
          <button role="menuitem" onClick={() => void archive(menu.chat)}>
            Archive
          </button>
          <button role="menuitem" className="danger" onClick={() => { setMenu(null); setConfirming(menu.chat) }}>
            Delete
          </button>
        </div>
      )}

      {confirming && (
        <div className="modal-backdrop" onClick={() => setConfirming(null)}>
          <div
            className="modal card"
            role="dialog"
            aria-modal="true"
            aria-label="Delete chat"
            onClick={(event) => event.stopPropagation()}
          >
            <h3>Delete “{confirming.title}”?</h3>
            <p>The chat and everything in it go to the Recycle Bin. You can get them back from there.</p>
            <div className="modal-actions">
              <button className="btn ghost" onClick={() => setConfirming(null)}>
                Keep it
              </button>
              <button className="btn danger" onClick={() => void remove(confirming)}>
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </aside>
  )
}
