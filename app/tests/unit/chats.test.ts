import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { ChatManager } from "../../src/main/chats"
import { SettingsStore } from "../../src/main/settings"
import type { Backend, BackendForm, BackendMessage, BackendSessionState, ModelInfo } from "../../src/main/backend/types"
import type { PopdEvent } from "../../src/shared/types"

class StalledBackend implements Backend {
  interrupted = 0
  status() {
    return "ready" as const
  }
  async start() {}
  async stop() {}
  async restart() {}
  logs() {
    return ""
  }
  async listModels(): Promise<ModelInfo[]> {
    return []
  }
  async connectKey() {}
  async connectIntegration() {}
  async listMcp() {
    return []
  }
  async sessionUsage() {
    return { input: 0, output: 0, cost: 0 }
  }
  async createSession(): Promise<string> {
    return "session-1"
  }
  async prompt() {}
  async session(): Promise<BackendSessionState> {
    return { id: "session-1", outcome: undefined, updated: 0 }
  }
  async forms(): Promise<BackendForm[]> {
    return []
  }
  async replyForm() {}
  async pendingPermissions(): Promise<string[]> {
    return []
  }
  async replyPermission() {}
  async messages(): Promise<BackendMessage[]> {
    return []
  }
  async interrupt() {
    this.interrupted++
  }
}

const dirs: string[] = []
function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "popd-chat-"))
  dirs.push(dir)
  return dir
}

class CompletingBackend implements Backend {
  constructor(private readonly text = "Done — your result is ready.") {}
  status() {
    return "ready" as const
  }
  async start() {}
  async stop() {}
  async restart() {}
  logs() {
    return ""
  }
  async listModels(): Promise<ModelInfo[]> {
    return []
  }
  async connectKey() {}
  async connectIntegration() {}
  async listMcp() {
    return []
  }
  async sessionUsage() {
    return { input: 0, output: 0, cost: 0 }
  }
  async createSession(): Promise<string> {
    return "session-ok"
  }
  async prompt() {}
  async session(): Promise<BackendSessionState> {
    return { id: "session-ok", outcome: "succeeded", updated: Date.now() }
  }
  async forms(): Promise<BackendForm[]> {
    return []
  }
  async replyForm() {}
  async pendingPermissions(): Promise<string[]> {
    return []
  }
  async replyPermission() {}
  async messages(): Promise<BackendMessage[]> {
    return [{ type: "assistant", text: this.text, tools: ["write"], at: Date.now() }]
  }
  async interrupt() {}
}

beforeEach(() => {
  process.env.POPD_STALL_MS = "600"
  process.env.POPD_POLL_MS = "200"
})

afterEach(() => {
  delete process.env.POPD_STALL_MS
  delete process.env.POPD_POLL_MS
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

describe("chat manager", () => {
  it("interrupts a run that stops making progress", async () => {
    const backend = new StalledBackend()
    const base = tempDir()
    const docs = tempDir()
    const events: PopdEvent[] = []
    const chats = new ChatManager({
      backend,
      settings: new SettingsStore(base, docs),
      indexPath: path.join(base, "chats.json"),
      emit: (event) => events.push(event),
    })

    const chat = chats.create("a stalled run")
    await chats.send(chat.id, "make me something")

    await new Promise((resolve) => setTimeout(resolve, 2500))

    const error = events.find((event) => event.type === "chat-error")
    expect(error).toBeTruthy()
    expect(error && error.type === "chat-error" ? error.retryable : false).toBe(true)
    expect(backend.interrupted).toBe(1)
    chats.stopAll()
  })

  it("surfaces a developer handoff written by the plugin", async () => {
    const backend = new CompletingBackend()
    const base = tempDir()
    const docs = tempDir()
    const events: PopdEvent[] = []
    const chats = new ChatManager({
      backend,
      settings: new SettingsStore(base, docs),
      indexPath: path.join(base, "chats.json"),
      emit: (event) => events.push(event),
    })

    const chat = chats.create("needs a developer")
    fs.writeFileSync(
      path.join(chat.workspace, "popd-escalation.json"),
      JSON.stringify({ reason: "api-key", explanation: "This needs a paid key." }),
    )
    await chats.send(chat.id, "do something impossible")

    await new Promise((resolve) => setTimeout(resolve, 900))

    const done = events.find((event) => event.type === "chat-done")
    expect(done && done.type === "chat-done" ? done.escalation?.explanation : null).toBe("This needs a paid key.")
    chats.stopAll()
  })

  it("strips developer-speak from the final message", async () => {
    const backend = new CompletingBackend("Run npm install and then npm run dev to see it.")
    const base = tempDir()
    const docs = tempDir()
    const events: PopdEvent[] = []
    const chats = new ChatManager({
      backend,
      settings: new SettingsStore(base, docs),
      indexPath: path.join(base, "chats.json"),
      emit: (event) => events.push(event),
    })

    const chat = chats.create("dev speak")
    await chats.send(chat.id, "make something")
    await new Promise((resolve) => setTimeout(resolve, 900))

    const done = events.find((event) => event.type === "chat-done")
    expect(done && done.type === "chat-done" ? done.message : null).toBe("Done — your result is ready.")
    chats.stopAll()
  })

  it("surfaces an API key request written by the plugin", async () => {
    const backend = new CompletingBackend()
    const base = tempDir()
    const docs = tempDir()
    const events: PopdEvent[] = []
    const chats = new ChatManager({
      backend,
      settings: new SettingsStore(base, docs),
      indexPath: path.join(base, "chats.json"),
      emit: (event) => events.push(event),
    })

    const chat = chats.create("needs a key")
    fs.writeFileSync(
      path.join(chat.workspace, ".popd-api-key-request.json"),
      JSON.stringify({ service: "demo", why: "Because." }),
    )
    await chats.send(chat.id, "make something")
    await new Promise((resolve) => setTimeout(resolve, 900))

    const done = events.find((event) => event.type === "chat-done")
    expect(done && done.type === "chat-done" ? done.apiKeyRequest?.service : null).toBe("demo")
    chats.stopAll()
  })
})
