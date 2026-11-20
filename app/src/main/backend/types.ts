import type { McpServerInfo } from "../../shared/types"

export interface BackendSessionState {
  id: string
  outcome?: string
  updated: number
  error?: string
}

export interface BackendFormField {
  key: string
  title: string
  type: string
  options?: Array<{ value: string; label: string }>
}

export interface BackendForm {
  id: string
  title: string
  fields: BackendFormField[]
}

export interface BackendMessage {
  type: "user" | "assistant" | "other"
  text: string
  tools: string[]
  reasoning?: string
  at: number
}

export interface ModelInfo {
  id: string
  providerID: string
  name: string
  hint?: string
}

export interface Backend {
  status(): "stopped" | "starting" | "ready" | "error"
  start(): Promise<void>
  stop(): Promise<void>
  restart(): Promise<void>
  listModels(): Promise<ModelInfo[]>
  connectKey(key: string): Promise<void>
  connectIntegration(integrationID: string, key: string): Promise<void>
  listMcp(directory: string): Promise<McpServerInfo[]>
  sessionUsage(sessionID: string): Promise<{ input: number; output: number; cost: number }>
  createSession(input: { title: string; directory: string; model: string; agent?: string }): Promise<string>
  removeSession(sessionID: string): Promise<void>
  prompt(sessionID: string, text: string): Promise<void>
  session(sessionID: string): Promise<BackendSessionState>
  forms(sessionID: string): Promise<BackendForm[]>
  replyForm(sessionID: string, formID: string, answer: Record<string, unknown>): Promise<void>
  pendingPermissions(sessionID: string): Promise<string[]>
  replyPermission(sessionID: string, requestID: string): Promise<void>
  messages(sessionID: string): Promise<BackendMessage[]>
  interrupt(sessionID: string): Promise<void>
  logs(): string
}
