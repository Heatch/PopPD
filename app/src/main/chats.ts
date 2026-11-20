import fs from "node:fs"
import path from "node:path"
import { randomUUID } from "node:crypto"
import { friendlyError } from "../shared/errors"
import type { ChatMessage, ChatSummary, PopdEvent, UsageEntry } from "../shared/types"
import type { Backend } from "./backend/types"
import { listArtifacts } from "./delivery/artifacts"
import {
  ensureLauncher,
  mainArtifactPath,
  readApiKeyRequest,
  sweepScaffolding,
} from "./delivery/launcher"
import { openPath } from "./delivery/shell"
import { ensureWorkspace } from "./delivery/workspace"
import { elapsedText, summarizeReasoning, toolsLine } from "./engine/progress"
import { preflight } from "./guardrails/preflight"
import { sanitize } from "./guardrails/lint"
import { estimateCostUsd } from "./model"
import type { SettingsStore } from "./settings"
import { readJson, writeJson } from "./storage"

const stallMs = () => Number(process.env.POPD_STALL_MS ?? 4 * 60_000)
const pollMs = () => Number(process.env.POPD_POLL_MS ?? 1500)

interface Run {
  sessionID: string
  prompt: string
  startedAt: number
  lastActivity: number
  asking: boolean
  lastLine: string
  lastDetail: string
  lastFingerprint: string
  baselineUpdated: number
  baselineAssistants: number
  timer?: NodeJS.Timeout
  ticking: boolean
}

export class ChatManager {
  private chats: ChatSummary[] = []
  private runs = new Map<string, Run>()
  private cancelled = new Set<string>()
  private lastBusy = false

  constructor(
    private deps: {
      backend: Backend
      settings: SettingsStore
      indexPath: string
      logDir?: string
      emit: (event: PopdEvent) => void
    },
  ) {
    this.chats = readJson<ChatSummary[]>(deps.indexPath, [])
    if (!Array.isArray(this.chats)) this.chats = []
  }

  private save() {
    writeJson(this.deps.indexPath, this.chats)
  }

  private emitBusy() {
    const busy = this.runs.size > 0
    if (busy !== this.lastBusy) {
      this.lastBusy = busy
      this.deps.emit({ type: "busy-changed", busy })
    }
  }

  list(): ChatSummary[] {
    return [...this.chats].sort((a, b) => b.updatedAt - a.updatedAt)
  }

  find(id: string): ChatSummary | undefined {
    return this.chats.find((chat) => chat.id === id)
  }

  create(title?: string, agent = "pop"): ChatSummary {
    const name = title?.trim() || "New idea"
    const workspace = ensureWorkspace(this.deps.settings.get().workspaceRoot, name)
    const now = Date.now()
    const chat: ChatSummary = {
      id: randomUUID(),
      title: name,
      workspace,
      createdAt: now,
      updatedAt: now,
      agent,
    }
    this.chats.push(chat)
    this.save()
    this.deps.emit({ type: "chats-changed" })
    return chat
  }

  rename(id: string, title: string) {
    const chat = this.find(id)
    if (!chat) return
    const next = title.trim().slice(0, 80)
    if (!next) return
    chat.title = next
    chat.updatedAt = Date.now()
    this.save()
    this.deps.emit({ type: "chats-changed" })
    this.deps.emit({ type: "library-changed" })
  }

  setPinned(id: string, pinned: boolean) {
    const chat = this.find(id)
    if (!chat) return
    chat.pinned = pinned || undefined
    this.save()
    this.deps.emit({ type: "chats-changed" })
  }

  async remove(id: string) {
    const chat = this.find(id)
    const run = this.runs.get(id)
    if (run?.timer) clearInterval(run.timer)
    this.runs.delete(id)
    this.emitBusy()
    if (chat?.sessionID) await this.deps.backend.removeSession(chat.sessionID).catch(() => {})
    this.chats = this.chats.filter((entry) => entry.id !== id)
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

  /** After a restart, pick up runs that were still going when the app last died. */
  async recover(): Promise<void> {
    for (const chat of this.chats) {
      if (!chat.sessionID || this.runs.has(chat.id)) continue
      let state
      try {
        state = await this.deps.backend.session(chat.sessionID)
      } catch {
        continue
      }
      if (state.outcome) continue

      const messages = await this.deps.backend.messages(chat.sessionID).catch(() => [])
      const lastUser = [...messages].reverse().find((message) => message.type === "user" && message.text.trim())
      const now = Date.now()
      const run: Run = {
        sessionID: chat.sessionID,
        prompt: lastUser?.text ?? "",
        startedAt: now,
        lastActivity: now,
        asking: false,
        lastLine: "",
        lastDetail: "",
        lastFingerprint: "",
        baselineUpdated: 0,
        baselineAssistants: 0,
        ticking: false,
      }
      this.runs.set(chat.id, run)
      run.timer = setInterval(() => void this.tick(chat.id), pollMs())
      this.deps.emit({ type: "chat-progress", chatId: chat.id, line: "Still working on this one…", elapsedMs: 0 })
      this.emitBusy()
      void this.tick(chat.id)
    }
  }

  async send(chatId: string, text: string) {
    const chat = this.find(chatId)
    if (!chat) throw new Error("Unknown chat")
    if (this.runs.has(chatId)) return
    this.cancelled.delete(chatId)

    const prompt = text.trim()
    if (!prompt) return

    // The window is usable before the engine finishes warming up; wait for it.
    await this.deps.backend.start()

    for (const warning of preflight(chat.workspace).warnings) {
      this.deps.emit({ type: "chat-warning", chatId, message: warning })
    }

    const freshSession = !chat.sessionID
    if (!chat.sessionID) {
      const title = chat.title === "New idea" ? prompt.slice(0, 48) : chat.title
      chat.sessionID = await this.deps.backend.createSession({
        title,
        directory: chat.workspace,
        model: this.deps.settings.get().model,
        agent: chat.agent ?? "pop",
      })
      chat.title = title
      this.save()
      this.deps.emit({ type: "chats-changed" })
    }

    // A previous turn leaves its outcome on the session until this one starts.
    const before = freshSession ? null : await this.deps.backend.session(chat.sessionID).catch(() => null)
    const prior = freshSession ? [] : await this.deps.backend.messages(chat.sessionID).catch(() => [])
    await this.deps.backend.prompt(chat.sessionID, prompt)
    // The person may have pressed Stop before the engine was ready.
    if (this.cancelled.has(chatId)) {
      this.cancelled.delete(chatId)
      await this.deps.backend.interrupt(chat.sessionID).catch(() => {})
      this.deps.emit({ type: "chat-stopped", chatId })
      return
    }
    const now = Date.now()
    const run: Run = {
      sessionID: chat.sessionID,
      prompt,
      startedAt: now,
      lastActivity: now,
      asking: false,
      lastLine: "",
      lastDetail: "",
      lastFingerprint: "",
      baselineUpdated: before?.updated ?? 0,
      baselineAssistants: prior.filter((message) => message.type === "assistant").length,
      ticking: false,
    }
    this.runs.set(chatId, run)
    this.emitBusy()
    this.deps.emit({ type: "chat-progress", chatId, line: "Getting started…", elapsedMs: 0 })
    run.timer = setInterval(() => void this.tick(chatId), pollMs())
  }

  async answer(chatId: string, formId: string, answer: Record<string, string | number | boolean | string[]>) {
    const run = this.runs.get(chatId)
    if (!run) return
    await this.deps.backend.replyForm(run.sessionID, formId, answer)
    run.asking = false
    run.lastActivity = Date.now()
    this.deps.emit({ type: "chat-progress", chatId, line: "Thanks — carrying on…", elapsedMs: Date.now() - run.startedAt })
  }

  /** Stops a run at the person's request (not an error). */
  async cancel(chatId: string) {
    const run = this.runs.get(chatId)
    if (!run) {
      // No run yet: the send is still waiting for the engine. Stop it there.
      this.cancelled.add(chatId)
      this.deps.emit({ type: "chat-stopped", chatId })
      return
    }
    this.clear(chatId, run)
    await this.deps.backend.interrupt(run.sessionID).catch(() => {})
    this.deps.emit({ type: "chat-stopped", chatId })
    this.deps.emit({ type: "chats-changed" })
  }

  /** Puts an archived chat back, with its original folder and timestamps. */
  adopt(chat: ChatSummary) {
    if (this.find(chat.id)) return
    this.chats.push(chat)
    this.save()
    this.deps.emit({ type: "chats-changed" })
    this.deps.emit({ type: "library-changed" })
  }

  stopAll() {
    for (const run of this.runs.values()) if (run.timer) clearInterval(run.timer)
    this.runs.clear()
    this.emitBusy()
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
      const reasoning = (lastAssistant?.reasoning ?? "").trim().slice(-12_000)
      const detail = summarizeReasoning(reasoning)

      // Streaming text or thinking counts as life, even if the session clock is quiet.
      const fingerprint = [
        messages.length,
        lastAssistant?.text.length ?? 0,
        reasoning.length,
        lastAssistant?.tools.length ?? 0,
      ].join(":")
      if (fingerprint !== run.lastFingerprint) {
        run.lastFingerprint = fingerprint
        run.lastActivity = Date.now()
      }

      if (line !== run.lastLine || detail !== run.lastDetail) {
        run.lastLine = line
        run.lastDetail = detail
        this.deps.emit({
          type: "chat-progress",
          chatId,
          line,
          detail: detail || undefined,
          reasoning: reasoning || undefined,
          elapsedMs: Date.now() - run.startedAt,
        })
      }

      const state = await this.deps.backend.session(run.sessionID)
      if (state.updated > run.lastActivity) run.lastActivity = state.updated

      // A finished outcome from the previous turn can still be on the session. Only
      // trust it once this turn has written its own answer.
      const assistants = messages.filter((message) => message.type === "assistant")
      const newest = assistants[assistants.length - 1]
      const newAnswer = assistants.length > run.baselineAssistants && Boolean(newest?.text.trim())
      const finished =
        state.outcome === "succeeded"
          ? newAnswer
          : Boolean(state.outcome) && state.updated > run.baselineUpdated
      if (finished) {
        await this.finish(chatId, run, state.outcome!, state.error)
        return
      }

      if (!run.asking && Date.now() - run.lastActivity > stallMs()) {
        this.guardrailLog(
          `chat=${chatId} stalled elapsed=${Date.now() - run.startedAt}ms silent=${Date.now() - run.lastActivity}ms line=${JSON.stringify(run.lastLine)} detail=${JSON.stringify(run.lastDetail.slice(0, 160))}`,
        )
        await this.deps.backend.interrupt(run.sessionID).catch(() => {})
        this.clear(chatId, run)
        this.deps.emit({
          type: "chat-error",
          chatId,
          message:
            "PopPD stopped this one after a few minutes without a response. Nothing is lost — try again, or tell me a change to make.",
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
    this.emitBusy()
  }

  private guardrailLog(line: string) {
    if (!this.deps.logDir) return
    try {
      fs.mkdirSync(this.deps.logDir, { recursive: true })
      const file = path.join(this.deps.logDir, "guardrails.log")
      try {
        if (fs.statSync(file).size > 1_000_000) fs.renameSync(file, `${file}.1`)
      } catch {
        // no log yet
      }
      fs.appendFileSync(file, `${new Date().toISOString()} ${line}\n`)
    } catch {
      // logging must never break a run
    }
  }

  private async finish(chatId: string, run: Run, outcome: string, error?: string) {
    const chat = this.find(chatId)
    this.clear(chatId, run)
    if (!chat) return
    if (outcome !== "succeeded") {
      this.guardrailLog(
        `chat=${chat.id} outcome=${outcome} error=${JSON.stringify((error ?? "").slice(0, 300))}`,
      )
      this.deps.emit({
        type: "chat-error",
        chatId,
        message:
          outcome === "interrupted"
            ? friendlyError("interrupted")
            : friendlyError(error),
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
      (artifacts.length > 0
        ? "Done — your result is ready."
        : "I'm here — tell me more whenever you're ready.")
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
        await openPath(main).catch(() => {})
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
