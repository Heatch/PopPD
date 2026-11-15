import { useCallback, useEffect, useRef, useState } from "react"
import type { ApiKeyRequest, Artifact, ChatMessage, EngineStatus, Question } from "../../../shared/types"

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
  engine,
  onBack,
  onRestartEngine,
}: {
  chatId: string
  initialPrompt?: string
  engine: EngineStatus
  onBack: () => void
  onRestartEngine: () => void
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [title, setTitle] = useState("")
  const [editingTitle, setEditingTitle] = useState(false)
  const [titleDraft, setTitleDraft] = useState("")
  const [progress, setProgress] = useState<{ line: string; elapsedMs: number } | null>(null)
  const [question, setQuestion] = useState<Question | null>(null)
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [artifacts, setArtifacts] = useState<Artifact[]>([])
  const [escalation, setEscalation] = useState<{ reason?: string; explanation?: string } | null>(null)
  const [apiKeyRequest, setApiKeyRequest] = useState<ApiKeyRequest | null>(null)
  const [warnings, setWarnings] = useState<string[]>([])
  const [keyValue, setKeyValue] = useState("")
  const [keyStatus, setKeyStatus] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [input, setInput] = useState("")
  const [lastPrompt, setLastPrompt] = useState("")
  const endRef = useRef<HTMLDivElement>(null)
  const sentInitial = useRef(false)

  useEffect(() => {
    void window.popd.getChat(chatId).then(({ chat, messages: stored }) => {
      setTitle(chat.title)
      setMessages(stored)
    })
    return window.popd.onEvent((event) => {
      if (!("chatId" in event) || event.chatId !== chatId) return
      if (event.type === "chat-progress") {
        setProgress({ line: event.line, elapsedMs: event.elapsedMs })
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
      }
    })
  }, [chatId])

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim()
      if (!trimmed || busy) return
      setBusy(true)
      setError(null)
      setQuestion(null)
      setArtifacts([])
      setEscalation(null)
      setApiKeyRequest(null)
      setWarnings([])
      setKeyValue("")
      setKeyStatus(null)
      setLastPrompt(trimmed)
      setProgress({ line: "Getting started…", elapsedMs: 0 })
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
    if (initialPrompt && !sentInitial.current) {
      sentInitial.current = true
      void send(initialPrompt)
    }
  }, [initialPrompt, send])

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" })
  }, [messages, progress, question, artifacts, error])

  const answer = async () => {
    if (!question) return
    const payload: Record<string, string | number | boolean | string[]> = {}
    for (const field of question.fields) {
      const value = answers[field.key] ?? ""
      payload[field.key] = field.type === "number" || field.type === "integer" ? Number(value || 0) : value
    }
    setQuestion(null)
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

  return (
    <div className="chat-shell">
      <header className="chat-header">
        <button className="btn ghost small" onClick={onBack}>
          ← Back
        </button>
        <div className="chat-title">{title || "Your chat"}</div>
        <button
          className="btn link small"
          aria-label="Rename chat"
          onClick={() => {
            setTitleDraft(title)
            setEditingTitle(true)
          }}
        >
          ✎
        </button>
        {editingTitle && (
          <div className="row" style={{ marginLeft: 8 }}>
            <input
              className="input"
              style={{ width: 220 }}
              value={titleDraft}
              autoFocus
              onChange={(event) => setTitleDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  void window.popd.renameChat(chatId, titleDraft).then(() => {
                    setTitle(titleDraft.trim() || title)
                    setEditingTitle(false)
                  })
                }
                if (event.key === "Escape") setEditingTitle(false)
              }}
            />
            <button
              className="btn small"
              onClick={() =>
                void window.popd.renameChat(chatId, titleDraft).then(() => {
                  setTitle(titleDraft.trim() || title)
                  setEditingTitle(false)
                })
              }
            >
              Save
            </button>
          </div>
        )}
        <span className="spacer" />
        {engine !== "ready" && (
          <span className={`engine-pill ${engine}`}>
            <span className="led" />
            {engine === "error" ? "Builder stopped" : "Warming up…"}
            {engine === "error" && (
              <button className="btn link small" onClick={onRestartEngine}>
                Restart
              </button>
            )}
          </span>
        )}
      </header>

      <div className="chat-scroll">
        <div className="container">
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
                <div key={index} className="msg-assistant">
                  {message.text}
                </div>
              ),
            )}

            {warnings.map((warning) => (
              <div key={warning} className="card" style={{ borderColor: "#e3b9a8", background: "#fff6f1" }}>
                <p>{warning}</p>
              </div>
            ))}

            {progress && (
              <div className="progress">
                <span className="dots">
                  <span />
                  <span />
                  <span />
                </span>
                {progress.line} <span className="muted">· {clock(progress.elapsedMs)}</span>
              </div>
            )}

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
              <div className="card" style={{ borderColor: "#e3b9a8", background: "#fff6f1" }}>
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
        <div className="container" style={{ paddingBottom: 0 }}>
          <div className="composer-inner">
            <textarea
              rows={1}
              value={input}
              placeholder={busy ? "PopPD is working…" : "Ask for a change…"}
              disabled={busy || Boolean(question)}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault()
                  void send(input)
                }
              }}
            />
            <button className="btn" disabled={busy || !input.trim() || Boolean(question)} onClick={() => void send(input)}>
              Send
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
