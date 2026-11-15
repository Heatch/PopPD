import fs from "node:fs"
import path from "node:path"
import { randomUUID } from "node:crypto"
import type { ChatMessage, ChatSummary, PopdEvent, UsageEntry } from "../shared/types"
import type { Backend } from "./backend/types"
import { listArtifacts } from "./delivery/artifacts"
import {
  ensureLauncher,
  mainArtifactPath,
  openPath,
  readApiKeyRequest,
  sweepScaffolding,
} from "./delivery/launcher"
import { ensureWorkspace } from "./delivery/workspace"
import { elapsedText, toolsLine } from "./engine/progress"
import { preflight } from "./guardrails/preflight"
import { sanitize } from "./guardrails/lint"
import { estimateCostUsd } from "./model"
import type { SettingsStore } from "./settings"

const stallMs = () => Number(process.env.POPD_STALL_MS ?? 4 * 60_000)
const pollMs = () => Number(process.env.POPD_POLL_MS ?? 1500)

interface Run {
  sessionID: string
  prompt: string
  startedAt: number
  lastActivity: number
  asking: boolean
  lastLine: string
  timer?: NodeJS.Timeout
  ticking: boolean
}

export class ChatManager {
  private chats: ChatSummary[] = []
  private runs = new Map<string, Run>()

  constructor(
    private deps: {
      backend: Backend
      settings: SettingsStore
      indexPath: string
      logDir?: string
      emit: (event: PopdEvent) => void
    },
  ) {
    this.load()
  }

  private load() {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.deps.indexPath, "utf8"))
      if (Array.isArray(parsed)) this.chats = parsed
    } catch {
      this.chats = []
    }
  }

  private save() {
    fs.mkdirSync(path.dirname(this.deps.indexPath), { recursive: true })
    fs.writeFileSync(this.deps.indexPath, JSON.stringify(this.chats, null, 2))
  }

  list(): ChatSummary[] {
    return [...this.chats].sort((a, b) => b.updatedAt - a.updatedAt)
  }

  find(id: string): ChatSummary | undefined {
    return this.chats.find((chat) => chat.id === id)
  }

  create(title?: string): ChatSummary {
    const name = title?.trim() || "New idea"
    const workspace = ensureWorkspace(this.deps.settings.get().workspaceRoot, name)
    const now = Date.now()
    const chat: ChatSummary = { id: randomUUID(), title: name, workspace, createdAt: now, updatedAt: now }
    this.chats.push(chat)
    this.save()
    this.deps.emit({ type: "chats-changed" })
    return chat
  }

  remove(id: string) {
    const run = this.runs.get(id)
    if (run?.timer) clearInterval(run.timer)
    this.runs.delete(id)
    this.chats = this.chats.filter((chat) => chat.id !== id)
    this.save()
    this.deps.emit({ type: "chats-changed" })
    this.deps.emit({ type: "library-changed" })
  }

  async messages(id: string): Promise<ChatMessage[]> {
    const chat = this.find(id)
    if (!chat?.sessionID) return []
    const messages = await this.deps.backend.messages(chat.sessionID).catch(() => [])
    return messages
      .filter((message) => (message.type === "user" || message.type === "assistant") && message.text.trim())
      .map((message) => ({ role: message.type as "user" | "assistant", text: message.text, at: message.at }))
  }

  async usage(): Promise<UsageEntry[]> {
    const model = this.deps.settings.get().model
    const entries: UsageEntry[] = []
    for (const chat of this.chats) {
      if (!chat.sessionID) continue
      const usage = await this.deps.backend.sessionUsage(chat.sessionID).catch(() => null)
      if (!usage) continue
      entries.push({
        chatId: chat.id,
        title: chat.title,
        input: usage.input,
        output: usage.output,
        costUsd: estimateCostUsd(model, usage.input, usage.output),
      })
    }
    return entries.sort((a, b) => b.input + b.output - (a.input + a.output))
  }

  async send(chatId: string, text: string) {
    const chat = this.find(chatId)
    if (!chat) throw new Error("Unknown chat")
    if (this.runs.has(chatId)) return

    const prompt = text.trim()
    if (!prompt) return

    // The window is usable before the engine finishes warming up; wait for it.
    await this.deps.backend.start()

    for (const warning of preflight(chat.workspace).warnings) {
      this.deps.emit({ type: "chat-warning", chatId, message: warning })
    }

    if (!chat.sessionID) {
      const title = chat.title === "New idea" ? prompt.slice(0, 48) : chat.title
      chat.sessionID = await this.deps.backend.createSession({
        title,
        directory: chat.workspace,
        model: this.deps.settings.get().model,
      })
      chat.title = title
      this.save()
      this.deps.emit({ type: "chats-changed" })
    }

    await this.deps.backend.prompt(chat.sessionID, prompt)
    const now = Date.now()
    const run: Run = {
      sessionID: chat.sessionID,
      prompt,
      startedAt: now,
      lastActivity: now,
      asking: false,
      lastLine: "",
      ticking: false,
    }
    this.runs.set(chatId, run)
    this.deps.emit({ type: "chat-progress", chatId, line: "Getting started…", elapsedMs: 0 })
    run.timer = setInterval(() => void this.tick(chatId), pollMs())
    void this.tick(chatId)
  }

  async answer(chatId: string, formId: string, answer: Record<string, string | number | boolean | string[]>) {
    const run = this.runs.get(chatId)
    if (!run) return
    await this.deps.backend.replyForm(run.sessionID, formId, answer)
    run.asking = false
    run.lastActivity = Date.now()
    this.deps.emit({ type: "chat-progress", chatId, line: "Thanks — carrying on…", elapsedMs: Date.now() - run.startedAt })
  }

  stopAll() {
    for (const run of this.runs.values()) if (run.timer) clearInterval(run.timer)
    this.runs.clear()
  }

  private async tick(chatId: string) {
    const run = this.runs.get(chatId)
    if (!run || run.ticking) return
    const chat = this.find(chatId)
    if (!chat) return
    run.ticking = true
    try {
      for (const requestID of await this.deps.backend.pendingPermissions(run.sessionID).catch(() => [])) {
        await this.deps.backend.replyPermission(run.sessionID, requestID).catch(() => {})
      }

      const forms = await this.deps.backend.forms(run.sessionID).catch(() => [])
      if (forms.length > 0 && !run.asking) {
        run.asking = true
        run.lastActivity = Date.now()
        const form = forms[0]
        this.deps.emit({
          type: "chat-question",
          chatId,
          question: {
            chatId,
            formId: form.id,
            title: form.title,
            fields: form.fields.map((field) => ({
              key: field.key,
              title: field.title,
              type: (["string", "number", "integer", "boolean", "multiselect"].includes(field.type)
                ? field.type
                : "string") as "string" | "number" | "integer" | "boolean" | "multiselect",
              options: field.options,
            })),
          },
        })
      }

      const messages = await this.deps.backend.messages(run.sessionID).catch(() => [])
      const lastAssistant = [...messages].reverse().find((message) => message.type === "assistant")
      const line = toolsLine(lastAssistant?.tools ?? [])
      if (line !== run.lastLine) {
        run.lastLine = line
        this.deps.emit({ type: "chat-progress", chatId, line, elapsedMs: Date.now() - run.startedAt })
      }

      const state = await this.deps.backend.session(run.sessionID)
      if (state.updated > run.lastActivity) run.lastActivity = state.updated

      if (state.outcome) {
        await this.finish(chatId, run, state.outcome)
        return
      }

      if (!run.asking && Date.now() - run.lastActivity > stallMs()) {
        await this.deps.backend.interrupt(run.sessionID).catch(() => {})
        this.clear(chatId, run)
        this.deps.emit({
          type: "chat-error",
          chatId,
          message: "It got stuck part-way through. Nothing is lost — try again or ask for a change.",
          retryable: true,
        })
        this.deps.emit({ type: "chats-changed" })
      }
    } finally {
      run.ticking = false
    }
  }

  private clear(chatId: string, run: Run) {
    if (run.timer) clearInterval(run.timer)
    this.runs.delete(chatId)
  }

  private guardrailLog(line: string) {
    if (!this.deps.logDir) return
    try {
      fs.mkdirSync(this.deps.logDir, { recursive: true })
      fs.appendFileSync(path.join(this.deps.logDir, "guardrails.log"), `${new Date().toISOString()} ${line}\n`)
    } catch {
      // logging must never break a run
    }
  }

  private async finish(chatId: string, run: Run, outcome: string) {
    const chat = this.find(chatId)
    this.clear(chatId, run)
    if (!chat) return
    if (outcome !== "succeeded") {
      this.deps.emit({
        type: "chat-error",
        chatId,
        message:
          outcome === "interrupted"
            ? "It stopped before finishing. Try again when you're ready."
            : "Something went wrong while making that. Your files are safe — try again.",
        retryable: true,
      })
      this.deps.emit({ type: "chats-changed" })
      return
    }

    sweepScaffolding(chat.workspace)
    ensureLauncher(chat.workspace)
    const artifacts = listArtifacts(chat.workspace)

    const messages = await this.deps.backend.messages(run.sessionID).catch(() => [])
    const raw =
      [...messages].reverse().find((entry) => entry.type === "assistant" && entry.text.trim())?.text.trim() ||
      "Done — your result is ready."
    const cleaned = sanitize(raw)
    if (cleaned.changed) {
      this.guardrailLog(
        `chat=${chat.id} removed=${cleaned.removed} before=${JSON.stringify(raw.slice(0, 300))} after=${JSON.stringify(cleaned.text.slice(0, 300))}`,
      )
    }

    const apiKeyRequest = readApiKeyRequest(chat.workspace) ?? undefined

    let escalation: { reason?: string; explanation?: string } | undefined
    try {
      escalation = JSON.parse(fs.readFileSync(path.join(chat.workspace, "popd-escalation.json"), "utf8"))
    } catch {
      escalation = undefined
    }

    let opened: string | undefined
    if (this.deps.settings.get().autoOpen && process.env.POPD_NO_OPEN !== "1") {
      const main = mainArtifactPath(chat.workspace)
      if (main) {
        openPath(main)
        opened = main
      }
    }

    chat.updatedAt = Date.now()
    this.save()
    this.deps.emit({
      type: "chat-done",
      chatId,
      message: cleaned.text,
      artifacts,
      opened,
      escalation,
      apiKeyRequest,
      sanitized: cleaned.changed,
    })
    this.deps.emit({ type: "chats-changed" })
    this.deps.emit({ type: "library-changed" })
  }
}

export { elapsedText }
