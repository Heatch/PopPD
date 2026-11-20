import { useEffect, useState } from "react"

const SUGGESTIONS = [
  "What kinds of things can you do?",
  "A budget spreadsheet for the month",
  "A one-page website for my club",
  "A chore tracker for the family",
  "A simple photo collage",
]

export function Home({ onStart }: { onStart: (prompt: string) => Promise<void> | void }) {
  const [prompt, setPrompt] = useState("")
  const [busy, setBusy] = useState(false)

  // Coming back from another screen should feel ready to type.
  useEffect(() => {
    const field = document.getElementById("home-prompt") as HTMLTextAreaElement | null
    field?.focus()
  }, [])

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
    <main className="home">
      <h1>What's on your mind?</h1>
      <p className="lead">
        Ask a question, think something through, or describe something you'd like made. If you
        want a thing built, PopPD handles the technical bits and hands it over ready to open.
      </p>

      <section className="prompt-card">
        <textarea
          id="home-prompt"
          autoFocus
          value={prompt}
          placeholder="Ask me anything… or a timer to help me focus, a spreadsheet for my expenses, a little website for my club…"
          onChange={(event) => setPrompt(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault()
              void submit()
            }
          }}
        />
        <div className="prompt-actions">
          <span className="hint">Just talking is fine too. Building may take a few minutes.</span>
          <button className="btn" disabled={!prompt.trim() || busy} onClick={() => void submit()}>
            Send
          </button>
        </div>
      </section>

      <div className="suggestions">
        {SUGGESTIONS.map((suggestion) => (
          <button key={suggestion} className="suggestion" onClick={() => setPrompt(suggestion)}>
            {suggestion}
          </button>
        ))}
      </div>
    </main>
  )
}
