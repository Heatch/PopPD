import { useState } from "react"

export function Onboarding({ onDone }: { onDone: () => Promise<void> | void }) {
  const [key, setKey] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async () => {
    if (!key.trim() || busy) return
    setBusy(true)
    setError(null)
    try {
      const result = await window.popd.connectKey(key.trim())
      if (!result.ok) {
        setError(result.error ?? "That key didn't work. Check it and try again.")
        return
      }
      await window.popd.saveSettings({ onboarded: true })
      await onDone()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="onboarding">
      <div className="panel">
        <span className="badge">One-time setup</span>
        <h1 style={{ marginTop: 14 }}>Hi. I'm PopPD.</h1>
        <p>
          I make things for you: little apps, spreadsheets, pictures, whatever you describe. To get
          started, paste the key that came with your PopPD account. You'll only do this once.
        </p>
        <div className="field">
          <label htmlFor="key">Your key</label>
          <input
            id="key"
            className="input"
            type="password"
            autoFocus
            value={key}
            placeholder="Paste it here"
            onChange={(event) => setKey(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void submit()
            }}
          />
        </div>
        {error && <p className="status-line bad">{error}</p>}
        <div className="row" style={{ marginTop: 22, justifyContent: "flex-end" }}>
          <button className="btn" disabled={!key.trim() || busy} onClick={() => void submit()}>
            {busy ? "Checking…" : "Start making things"}
          </button>
        </div>
      </div>
    </div>
  )
}
