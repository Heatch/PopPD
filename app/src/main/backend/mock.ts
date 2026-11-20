import fs from "node:fs"
import path from "node:path"
import { randomUUID } from "node:crypto"
import type { Backend, BackendForm, BackendMessage, BackendSessionState, ModelInfo } from "./types"

interface MockSession {
  id: string
  title: string
  directory: string
  prompt: string
  startedAt: number
  form?: BackendForm
  formAnsweredAt?: number
  outcome?: string
  interrupted?: boolean
  artifactWritten?: boolean
  tools: string[]
  log: Array<{ prompt: string; at: number }>
}

const SPEED = Number(process.env.POPD_MOCK_SPEED ?? 1)
const FINISH_MS = 5200 * SPEED

/**
 * Scripted backend for UI tests and demos. It follows the same shape as the real
 * backend: progress, an optional clarifying question, a written artifact, then done.
 */
export class MockBackend implements Backend {
  private sessions = new Map<string, MockSession>()
  private started = false

  status() {
    return this.started ? ("ready" as const) : ("stopped" as const)
  }

  async start(): Promise<void> {
    this.started = true
    await new Promise((r) => setTimeout(r, 150))
  }

  async stop(): Promise<void> {
    this.started = false
  }

  async restart(): Promise<void> {
    this.started = false
    await this.start()
  }

  logs(): string {
    return "[mock engine] no real engine running"
  }

  async listModels(): Promise<ModelInfo[]> {
    return [
      { id: "deepseek-v4.1-flash", providerID: "opencode-go", name: "DeepSeek V4.1 Flash", hint: "Fast · default" },
      { id: "deepseek-v4-pro", providerID: "opencode-go", name: "DeepSeek V4 Pro", hint: "Stronger · slower" },
      { id: "kimi-k2.7-code", providerID: "opencode-go", name: "Kimi K2.7 Code" },
    ]
  }

  async connectKey(key: string): Promise<void> {
    if (key.trim().length < 8) throw new Error("That key looks too short.")
    await new Promise((r) => setTimeout(r, 300))
  }

  async connectIntegration(_integrationID: string, key: string): Promise<void> {
    if (key.trim().length < 8) throw new Error("That key looks too short.")
    await new Promise((r) => setTimeout(r, 200))
  }

  async listMcp(): Promise<Array<{ name: string; status: string; enabled: boolean }>> {
    return [{ name: "demo-tools", status: "connected", enabled: true }]
  }

  async sessionUsage(): Promise<{ input: number; output: number; cost: number }> {
    return { input: 12_400, output: 3_200, cost: 0 }
  }

  async createSession(input: { title: string; directory: string; model: string; agent?: string }): Promise<string> {
    const id = `mock_${randomUUID()}`
    this.sessions.set(id, {
      id,
      title: input.title,
      directory: input.directory,
      prompt: "",
      startedAt: Date.now(),
      tools: [],
      log: [],
    })
    return id
  }

  async removeSession(sessionID: string): Promise<void> {
    this.sessions.delete(sessionID)
  }

  async prompt(sessionID: string, text: string): Promise<void> {
    const session = this.get(sessionID)
    session.prompt = text
    session.startedAt = Date.now()
    session.outcome = undefined
    session.interrupted = false
    session.log.push({ prompt: text, at: session.startedAt })
    session.form = undefined
    session.formAnsweredAt = undefined
    if (/chore/i.test(text)) {
      setTimeout(() => {
        session.form = {
          id: `form_${randomUUID()}`,
          title: "Who is this list for?",
          fields: [
            {
              key: "who",
              title: "Who is this for?",
              type: "string",
              options: [
                { value: "just-me", label: "Just me" },
                { value: "family", label: "My family" },
              ],
            },
          ],
        }
      }, Math.min(1800, FINISH_MS / 2))
    }
  }

  async session(sessionID: string): Promise<BackendSessionState> {
    const session = this.get(sessionID)
    if (!session.prompt) return { id: sessionID, outcome: undefined, updated: Date.now() }
    const elapsed = Date.now() - session.startedAt
    const blocked = session.form && !session.formAnsweredAt
    if (!blocked && elapsed > FINISH_MS && !session.outcome) {
      session.outcome = session.interrupted ? "interrupted" : "succeeded"
      this.writeArtifact(session)
    }
    return { id: sessionID, outcome: session.outcome, updated: Date.now() }
  }

  async forms(sessionID: string): Promise<BackendForm[]> {
    const session = this.get(sessionID)
    return session.form && !session.formAnsweredAt ? [session.form] : []
  }

  async replyForm(_sessionID: string, formID: string, _answer: Record<string, unknown>): Promise<void> {
    const session = [...this.sessions.values()].find((s) => s.form?.id === formID)
    if (session) {
      session.formAnsweredAt = Date.now()
      session.tools.push("write", "shell")
    }
  }

  async pendingPermissions(): Promise<string[]> {
    return []
  }

  async replyPermission(): Promise<void> {}

  async interrupt(sessionID: string): Promise<void> {
    const session = this.get(sessionID)
    session.interrupted = true
    session.outcome = "interrupted"
  }

  async messages(sessionID: string): Promise<BackendMessage[]> {
    const session = this.get(sessionID)
    const messages: BackendMessage[] = []
    for (let index = 0; index < session.log.length; index++) {
      const turn = session.log[index]
      const current = index === session.log.length - 1
      const elapsed = Date.now() - turn.at
      messages.push({ type: "user", text: turn.prompt, tools: [], at: turn.at })
      if (current) {
        messages.push({
          type: "assistant",
          text: session.outcome === "succeeded" ? "Done — it's ready." : "",
          tools: this.toolsAt(elapsed),
          reasoning: this.reasoningAt(elapsed),
          at: turn.at + elapsed,
        })
      } else {
        messages.push({
          type: "assistant",
          text: "Done — it's ready.",
          tools: ["write", "open_with_default_app"],
          at: turn.at + 1000,
        })
      }
    }
    return messages
  }

  private toolsAt(elapsed: number): string[] {
    if (elapsed < 900) return ["read"]
    if (elapsed < 1800) return ["write"]
    if (elapsed < 2800) return ["write", "edit"]
    if (elapsed < 4000) return ["write", "edit", "shell"]
    return ["write", "edit", "shell", "open_with_default_app"]
  }

  private reasoningAt(elapsed: number): string {
    if (elapsed < 900) return "Reading the request and planning a simple single-page layout."
    if (elapsed < 1800) return "Writing the page structure and the timer markup."
    if (elapsed < 2800) return "Styling the timer, buttons and the daily counter so it feels calm."
    if (elapsed < 4000) return "Checking the countdown logic and the reset behaviour."
    return "Polishing the last details and preparing the launcher."
  }

  private writeArtifact(session: MockSession) {
    if (session.artifactWritten) return
    session.artifactWritten = true
    fs.mkdirSync(session.directory, { recursive: true })
    const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Something lovely</title>
<style>body{font-family:system-ui;background:#f7f2e8;color:#2c2822;display:grid;place-items:center;min-height:100vh;margin:0}
main{background:#fffdf8;border:1px solid #e8e0d2;border-radius:24px;padding:48px;text-align:center;max-width:420px}
h1{font-size:2rem;margin:0 0 .5rem}p{color:#8a8175;margin:0}</style></head>
<body><main><h1>It works!</h1><p>This is a demo artifact from the PopPD mock engine.</p></main></body></html>`
    fs.writeFileSync(path.join(session.directory, "index.html"), html)

    if (/api key/i.test(session.prompt)) {
      fs.writeFileSync(
        path.join(session.directory, ".popd-api-key-request.json"),
        JSON.stringify({
          service: "demo-service",
          url: "https://example.com/keys",
          why: "This demo needs a key.",
        }),
      )
    }
    if (/developer/i.test(session.prompt)) {
      fs.writeFileSync(
        path.join(session.directory, "popd-escalation.json"),
        JSON.stringify({ reason: "scale", explanation: "A developer should take this further." }),
      )
    }
  }

  private get(sessionID: string): MockSession {
    const session = this.sessions.get(sessionID)
    if (!session) throw new Error(`unknown session ${sessionID}`)
    return session
  }
}
