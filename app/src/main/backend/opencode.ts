import type { Backend, BackendForm, BackendMessage, BackendSessionState, ModelInfo } from "./types"
import type { EngineSupervisor } from "../engine/supervisor"
import { modelHint, parseModel } from "../model"
import { waitForId } from "./wait"

export class OpenCodeBackend implements Backend {
  constructor(private supervisor: EngineSupervisor) {}

  private client(): any {
    return this.supervisor.clientOrThrow()
  }

  status() {
    return this.supervisor.status
  }

  async start(): Promise<void> {
    await this.supervisor.start()
  }

  async stop(): Promise<void> {
    await this.supervisor.stop()
  }

  async restart(): Promise<void> {
    await this.supervisor.restart()
  }

  logs(): string {
    return this.supervisor.logs
  }

  async listModels(): Promise<ModelInfo[]> {
    let result: any = await this.client().model.list()
    // On a fresh engine the model catalog can still be loading.
    if (!(result?.data ?? []).length) {
      await new Promise((resolve) => setTimeout(resolve, 1000))
      result = await this.client().model.list().catch(() => result)
    }
    const data: any[] = result?.data ?? []
    return data
      .filter((model) => model?.providerID === "opencode-go")
      .map((model) => ({
        id: String(model.id),
        providerID: String(model.providerID),
        name: String(model.name ?? model.id),
        hint: modelHint(String(model.id)),
      }))
      .sort((a, b) => {
        const rank = (m: ModelInfo) => (m.hint?.includes("default") ? 0 : m.hint?.includes("Stronger") ? 1 : 2)
        return rank(a) - rank(b)
      })
  }

  private async integrationIds(): Promise<string[]> {
    const list: any = await this.client().integration.list()
    return (list?.data ?? []).map((entry: any) => String(entry.id))
  }

  async connectKey(key: string): Promise<void> {
    const ready = await waitForId(() => this.integrationIds(), "opencode-go")
    if (!ready) throw new Error("The builder is still getting ready. Wait a moment and try again.")
    await this.client().integration.connect.key({ integrationID: "opencode-go", key })
  }

  async connectIntegration(integrationID: string, key: string): Promise<void> {
    const ready = await waitForId(() => this.integrationIds(), integrationID)
    if (!ready) throw new Error(`The builder doesn't recognise ${integrationID}.`)
    await this.client().integration.connect.key({ integrationID, key })
  }

  async listMcp(directory: string): Promise<Array<{ name: string; status: string; enabled: boolean }>> {
    const result: any = await this.client().mcp.list({ location: { directory } })
    return (result?.data ?? []).map((server: any) => ({
      name: String(server.name),
      status: String(server.status?.status ?? server.status ?? "unknown"),
      enabled: !server.disabled,
    }))
  }

  async sessionUsage(sessionID: string): Promise<{ input: number; output: number; cost: number }> {
    const info: any = await this.client().session.get({ sessionID })
    return {
      input: Number(info?.tokens?.input ?? 0),
      output: Number(info?.tokens?.output ?? 0),
      cost: Number(info?.cost ?? 0),
    }
  }

  async createSession(input: { title: string; directory: string; model: string; agent?: string }): Promise<string> {
    const session = await this.client().session.create({
      title: input.title,
      agent: input.agent ?? "pop",
      model: parseModel(input.model),
      location: { directory: input.directory },
    })
    return String(session.id)
  }

  async removeSession(sessionID: string): Promise<void> {
    await this.client().session.remove({ sessionID })
  }

  async prompt(sessionID: string, text: string): Promise<void> {
    await this.client().session.prompt({ sessionID, text })
  }

  async session(sessionID: string): Promise<BackendSessionState> {
    const info: any = await this.client().session.get({ sessionID })
    const error = info?.error ? JSON.stringify(info.error).slice(0, 400) : undefined
    return {
      id: sessionID,
      outcome: info?.outcome,
      updated: Number(info?.time?.updated ?? Date.now()),
      error,
    }
  }

  async forms(sessionID: string): Promise<BackendForm[]> {
    const list: any = await this.client().session.form.list({ sessionID })
    return (Array.isArray(list) ? list : []).map((form: any) => ({
      id: String(form.id),
      title: String(form.title ?? "A quick question"),
      fields: (form.fields ?? []).map((field: any) => ({
        key: String(field.key),
        title: String(field.title ?? field.key),
        type: String(field.type ?? "string"),
        options: (field.options ?? []).map((option: any) => ({
          value: String(option.value),
          label: String(option.label ?? option.value),
        })),
      })),
    }))
  }

  async replyForm(sessionID: string, formID: string, answer: Record<string, unknown>): Promise<void> {
    await this.client().session.form.reply({ sessionID, formID, answer })
  }

  async pendingPermissions(sessionID: string): Promise<string[]> {
    const result: any = await this.client().permission.request.list({ sessionID })
    return (result?.data ?? []).map((request: any) => String(request.id))
  }

  async replyPermission(sessionID: string, requestID: string): Promise<void> {
    await this.client().permission.reply({ sessionID, requestID, decision: "once" })
  }

  async messages(sessionID: string): Promise<BackendMessage[]> {
    const page: any = await this.client().message.list({ sessionID, order: "asc", limit: 200 })
    const data: any[] = page?.data ?? []
    return data.map((message) => {
      if (message.type === "user") {
        return { type: "user" as const, text: String(message.text ?? ""), tools: [], at: Number(message.time?.created ?? 0) }
      }
      if (message.type !== "assistant") {
        return { type: "other" as const, text: "", tools: [], at: Number(message.time?.created ?? 0) }
      }
      const parts: any[] = message.content ?? []
      return {
        type: "assistant" as const,
        text: parts
          .filter((part) => part?.type === "text" && typeof part.text === "string")
          .map((part) => part.text)
          .join("\n")
          .trim(),
        tools: parts.filter((part) => part?.type === "tool" && part.name).map((part) => String(part.name)),
        reasoning: parts
          .filter((part) => part?.type === "reasoning" && typeof part.text === "string")
          .map((part) => part.text)
          .join("\n"),
        at: Number(message.time?.created ?? 0),
      }
    })
  }

  async interrupt(sessionID: string): Promise<void> {
    await this.client().session.interrupt({ sessionID })
  }
}
