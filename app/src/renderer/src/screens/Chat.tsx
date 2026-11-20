import { useCallback, useEffect, useRef, useState } from "react"
import type { ApiKeyRequest, Artifact, ChatMessage, Question } from "../../../shared/types"

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

function clock(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000))
  if (seconds < 60) return `${seconds}s`
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`
}

export function Chat({
  chatId,
  initialPrompt,
  initialRun,
  initialQuestion,
  onQuestionAnswered,
  onBack,
}: {
  chatId: string
  initialPrompt?: string
  initialRun?: { line: string; startedAt: number; detail?: string; reasoning?: string }
  initialQuestion?: Question
  onQuestionAnswered?: (chatId: string) => void
  onBack: () => void
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [title, setTitle] = useState("")
  const [editingTitle, setEditingTitle] = useState(false)
  const [titleDraft, setTitleDraft] = useState("")
  const [progress, setProgress] = useState<{
    line: string
    startedAt: number
    detail?: string
    reasoning?: string
  } | null>(initialRun ?? null)
  const [thinkingOpen, setThinkingOpen] = useState(false)
  const [now, setNow] = useState(Date.now())
  const [question, setQuestion] = useState<Question | null>(initialQuestion ?? null)
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [artifacts, setArtifacts] = useState<Artifact[]>([])
  const [escalation, setEscalation] = useState<{ reason?: string; explanation?: string } | null>(null)
  const [apiKeyRequest, setApiKeyRequest] = useState<ApiKeyRequest | null>(null)
  const [warnings, setWarnings] = useState<string[]>([])
  const [keyValue, setKeyValue] = useState("")
  const [keyStatus, setKeyStatus] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [stopped, setStopped] = useState(false)
  const [busy, setBusy] = useState(Boolean(initialRun))
  const [loaded, setLoaded] = useState(false)
  const [input, setInput] = useState("")
  const [lastPrompt, setLastPrompt] = useState("")
  const endRef = useRef<HTMLDivElement>(null)
  const thinkingRef = useRef<HTMLDivElement>(null)
  const sentInitial = useRef(false)

  useEffect(() => {
    let active = true
    void window.popd
      .getChat(chatId)
      .then(({ chat, messages: stored, artifacts: files, escalation: handoff, apiKeyRequest: keyRequest }) => {
        if (!active) return
        setTitle(chat.title)
        // Never erase something the person already typed or a finished result.
        setMessages((current) => (current.length === 0 ? stored : current))
        setArtifacts((current) => (current.length === 0 ? files : current))
        setEscalation((current) => current ?? handoff ?? null)
        setApiKeyRequest((current) => current ?? keyRequest ?? null)
        setLoaded(true)
      })
      .catch(() => {
        if (active) setLoaded(true)
      })
    const off = window.popd.onEvent((event) => {
      if (!("chatId" in event) || event.chatId !== chatId) return
      if (event.type === "chat-progress") {
        setProgress({
          line: event.line,
          detail: event.detail,
          reasoning: event.reasoning,
          startedAt: Date.now() - event.elapsedMs,
        })
      } else if (event.type === "chat-warning") {
        setWarnings((current) => (current.includes(event.message) ? current : [...current, event.message]))
      } else if (event.type === "chat-question") {
        setQuestion(event.question)
        setAnswers({})
      } else if (event.type === "chat-done") {
        setBusy(false)
        setProgress(null)
        setQuestion(null)
        setArtifacts(event.artifacts)
        setEscalation(event.escalation ?? null)
        setApiKeyRequest(event.apiKeyRequest ?? null)
        if (event.message) {
          setMessages((current) => [...current, { role: "assistant", text: event.message, at: Date.now() }])
        }
      } else if (event.type === "chat-error") {
        setBusy(false)
        setProgress(null)
        setError(event.message)
      } else if (event.type === "chat-stopped") {
        setBusy(false)
        setProgress(null)
        setStopped(true)
      }
    })
    return () => {
      active = false
      off()
    }
  }, [chatId])

  // Keep the elapsed time moving between engine updates.
  useEffect(() => {
    if (!progress) return
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [progress])

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim()
      if (!trimmed || busy) return
      setBusy(true)
      setError(null)
      setStopped(false)
      setQuestion(null)
      setEscalation(null)
      setApiKeyRequest(null)
      setWarnings([])
      setKeyValue("")
      setKeyStatus(null)
      setLastPrompt(trimmed)
      setProgress({ line: "Getting started…", startedAt: Date.now() })
      setMessages((current) => [...current, { role: "user", text: trimmed, at: Date.now() }])
      setInput("")
      try {
        await window.popd.send(chatId, trimmed)
      } catch (thrown) {
        setBusy(false)
        setProgress(null)
        setError(thrown instanceof Error ? thrown.message : String(thrown))
      }
    },
    [busy, chatId],
  )

  useEffect(() => {
    if (!loaded) return
    if (initialPrompt && !sentInitial.current) {
      sentInitial.current = true
      void send(initialPrompt)
    }
  }, [initialPrompt, loaded, send])

  useEffect(() => {
    // While an expanded thinking panel is open, leave the page where it is.
    if (thinkingOpen && progress) return
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" })
  }, [messages, progress, question, artifacts, error, thinkingOpen])

  // Keep the newest line of thinking in view.
  useEffect(() => {
    if (!thinkingOpen || !thinkingRef.current) return
    thinkingRef.current.scrollTop = thinkingRef.current.scrollHeight
  }, [thinkingOpen, progress?.reasoning])

  const answer = async () => {
    if (!question) return
    const payload: Record<string, string | number | boolean | string[]> = {}
    for (const field of question.fields) {
      const value = answers[field.key] ?? ""
      payload[field.key] = field.type === "number" || field.type === "integer" ? Number(value || 0) : value
    }
    setQuestion(null)
    onQuestionAnswered?.(chatId)
    await window.popd.answerQuestion(chatId, question.formId, payload)
  }

  const saveServiceKey = async () => {
    if (!apiKeyRequest || !keyValue.trim()) return
    const integrationID = apiKeyRequest.service
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
    const result = await window.popd.connectServiceKey(integrationID, keyValue.trim())
    setKeyStatus(result.ok ? "Saved. Ask PopPD to carry on." : result.error ?? "That key didn't work.")
    if (result.ok) setKeyValue("")
  }

  const rename = async () => {
    const next = titleDraft.trim()
    if (!next) {
      setEditingTitle(false)
      return
    }
    await window.popd.renameChat(chatId, next)
    setTitle(next)
    setEditingTitle(false)
  }

  const elapsed = progress ? Math.max(0, now - progress.startedAt) : 0

  return (
    <div className="chat-shell">
      <header className="chat-header">
        {editingTitle ? (
          <>
            <input
              className="input"
              style={{ width: 260 }}
              value={titleDraft}
              autoFocus
              onChange={(event) => setTitleDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void rename()
                if (event.key === "Escape") setEditingTitle(false)
              }}
            />
            <button className="btn small" onClick={() => void rename()}>
              Save
            </button>
          </>
        ) : (
          <>
            <div className="chat-title">{title || "Your chat"}</div>
            <button
              className="btn link small"
              aria-label="Rename chat"
              title="Rename chat"
              onClick={() => {
                setTitleDraft(title)
                setEditingTitle(true)
              }}
            >
              Rename
            </button>
          </>
        )}
      </header>

      <div className="chat-scroll">
        <div className="chat-content">
          <div className="messages">
            {messages.length === 0 && !progress && (
              <p className="muted">Tell PopPD what you'd like, in your own words.</p>
            )}

            {messages.map((message, index) =>
              message.role === "user" ? (
                <div key={index} className="msg-user">
                  {message.text}
                </div>
              ) : (
                <div key={index} className="msg-assistant-block">
                  <div className="msg-author">
                    <span className="author-dot" />
                    PopPD
                  </div>
                  <div className="msg-assistant">{message.text}</div>
                </div>
              ),
            )}

            {warnings.map((warning) => (
              <div key={warning} className="card warn-card">
                <p>{warning}</p>
              </div>
            ))}

            {progress && (
              <div className={`thinking ${thinkingOpen ? "open" : ""}`}>
                <button
                  className="thinking-head"
                  aria-expanded={thinkingOpen}
                  onClick={() => setThinkingOpen((open) => !open)}
                >
                  <span className="dots">
                    <span />
                    <span />
                    <span />
                  </span>
                  <span className="thinking-line">{progress.line}</span>
                  <span className="thinking-time">· {clock(elapsed)}</span>
                  <span className="chevron" aria-hidden>
                    ⌄
                  </span>
                </button>
                {!thinkingOpen && progress.detail && <p className="thinking-peek">{progress.detail}</p>}
                {thinkingOpen && (
                  <div className="thinking-body" ref={thinkingRef}>
                    {progress.reasoning ? (
                      <p>{progress.reasoning}</p>
                    ) : (
                      <p className="muted">PopPD hasn't written anything down yet. It's still working.</p>
                    )}
                  </div>
                )}
              </div>
            )}

            {stopped && <p className="muted">Stopped. Ask again whenever you're ready.</p>}

            {question && (
              <div className="card question-card">
                <h3>{question.title}</h3>
                <p>Pick an option and PopPD will carry on.</p>
                {question.fields.map((field) => (
                  <div className="field" key={field.key}>
                    <label>{field.title}</label>
                    {field.options && field.options.length > 0 ? (
                      <div className="question-options">
                        {field.options.map((option) => (
                          <button
                            key={option.value}
                            className="chip"
                            aria-pressed={answers[field.key] === option.value}
                            onClick={() => setAnswers((current) => ({ ...current, [field.key]: option.value }))}
                          >
                            {option.label}
                          </button>
                        ))}
                      </div>
                    ) : (
                      <input
                        className="input"
                        value={answers[field.key] ?? ""}
                        onChange={(event) =>
                          setAnswers((current) => ({ ...current, [field.key]: event.target.value }))
                        }
                      />
                    )}
                  </div>
                ))}
                <div className="row" style={{ marginTop: 16 }}>
                  <button
                    className="btn"
                    disabled={question.fields.some((field) => !(answers[field.key] ?? "").trim())}
                    onClick={() => void answer()}
                  >
                    Carry on
                  </button>
                </div>
              </div>
            )}

            {artifacts.length > 0 && (
              <div>
                <h2 className="section-title" style={{ marginBottom: 10 }}>
                  Your result
                </h2>
                <div className="artifacts">
                  {artifacts.map((artifact) => (
                    <div className="artifact" key={artifact.path}>
                      <div className="glyph">{GLYPH[artifact.kind] ?? "📦"}</div>
                      <div style={{ minWidth: 0 }}>
                        <div className="name">{artifact.name}</div>
                        <div className="size">
                          {artifact.kind === "web" ? "Web page" : artifact.kind} · {humanSize(artifact.bytes)}
                        </div>
                      </div>
                      <span className="spacer" />
                      <button className="btn small" onClick={() => void window.popd.openArtifact(artifact.path)}>
                        Open
                      </button>
                      <button className="btn ghost small" onClick={() => void window.popd.showInFolder(artifact.path)}>
                        Show in folder
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {escalation && (
              <div className="card warn-card">
                <h3>This one needs a real developer</h3>
                <p>{escalation.explanation ?? "A person should take this one a step further."}</p>
                {escalation.reason && <p className="status-line">Reason: {escalation.reason}</p>}
              </div>
            )}

            {apiKeyRequest && (
              <div className="card question-card">
                <h3>A key for {apiKeyRequest.service}</h3>
                <p>{apiKeyRequest.why ?? "This part needs a key from that service."}</p>
                {apiKeyRequest.url && (
                  <div className="row" style={{ marginTop: 12 }}>
                    <button
                      className="btn ghost"
                      onClick={() => void window.popd.openExternal(apiKeyRequest.url!)}
                    >
                      Open the page
                    </button>
                  </div>
                )}
                <div className="field">
                  <label htmlFor="service-key">Paste the key</label>
                  <input
                    id="service-key"
                    className="input"
                    type="password"
                    value={keyValue}
                    onChange={(event) => setKeyValue(event.target.value)}
                  />
                </div>
                {keyStatus && <p className="status-line">{keyStatus}</p>}
                <div className="row" style={{ marginTop: 14 }}>
                  <button className="btn" disabled={!keyValue.trim()} onClick={() => void saveServiceKey()}>
                    Save key
                  </button>
                </div>
              </div>
            )}

            {error && (
              <div className="card error-card">
                <h3>That didn't go to plan</h3>
                <p>{error}</p>
                <div className="row" style={{ marginTop: 14 }}>
                  <button
                    className="btn"
                    onClick={() => {
                      setError(null)
                      void send(lastPrompt)
                    }}
                  >
                    Try again
                  </button>
                  <button className="btn ghost" onClick={onBack}>
                    Back home
                  </button>
                </div>
              </div>
            )}

            <div ref={endRef} />
          </div>
        </div>
      </div>

      <div className="composer">
        {busy || question ? (
          <div className="composer-status">
            <div className="composer-status-row">
              <span className="dots">
                <span />
                <span />
                <span />
              </span>
              {question ? "Waiting for your answer above" : "PopPD is working…"}
              {busy && progress && <span className="elapsed">{clock(elapsed)}</span>}
              {busy && (
                <button className="btn link small stop" onClick={() => void window.popd.cancelChat(chatId)}>
                  Stop
                </button>
              )}
            </div>
            {busy && progress && (
              <div className="composer-detail">
                <button
                  className="composer-line"
                  aria-expanded={thinkingOpen}
                  title={thinkingOpen ? "Hide thinking" : "Show thinking"}
                  onClick={() => setThinkingOpen((open) => !open)}
                >
                  {progress.line}
                  <span className={`chevron ${thinkingOpen ? "open" : ""}`} aria-hidden>
                    ⌄
                  </span>
                </button>
              </div>
            )}
          </div>
        ) : (
          <div className="composer-inner">
            <textarea
              rows={1}
              value={input}
              placeholder="Ask for a change…"
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault()
                  void send(input)
                }
              }}
            />
            <button className="btn" disabled={!input.trim()} onClick={() => void send(input)}>
              Send
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
