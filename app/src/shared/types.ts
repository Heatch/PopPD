export type EngineStatus = "stopped" | "starting" | "ready" | "error"

export type ArtifactKind =
  | "web"
  | "image"
  | "video"
  | "audio"
  | "pdf"
  | "sheet"
  | "slides"
  | "doc"
  | "svg"
  | "text"
  | "other"

export interface Artifact {
  path: string
  name: string
  kind: ArtifactKind
  bytes: number
}

export interface ChatSummary {
  id: string
  title: string
  workspace: string
  createdAt: number
  updatedAt: number
  /** Engine session, kept internal to the main process. */
  sessionID?: string
  /** Which persona built it (defaults to pop). */
  agent?: string
  /** Kept at the top of the sidebar. */
  pinned?: boolean
}

export interface ChatMessage {
  role: "user" | "assistant"
  text: string
  at: number
}

export interface ModelOption {
  id: string
  providerID: string
  name: string
  hint?: string
}

export interface QuestionOption {
  value: string
  label: string
}

export interface QuestionField {
  key: string
  title: string
  type: "string" | "number" | "integer" | "boolean" | "multiselect"
  options?: QuestionOption[]
}

export interface Question {
  chatId: string
  formId: string
  title: string
  fields: QuestionField[]
}

export interface McpServerSetting {
  enabled: boolean
  command?: string[]
  url?: string
}

export interface Settings {
  onboarded: boolean
  model: string
  workspaceRoot: string
  autoOpen: boolean
  notifications: boolean
  theme: "system" | "light" | "dark"
  allowMcp: boolean
  mcpServers: Record<string, McpServerSetting>
}

export interface LibraryEntry {
  chatId: string
  chatTitle: string
  workspace: string
  main: Artifact | null
  artifacts: Artifact[]
  thumb: string | null
  updatedAt: number
}

export interface ApiKeyRequest {
  service: string
  url?: string
  why?: string
}

export interface McpServerInfo {
  name: string
  status: string
  enabled: boolean
}

export interface UsageEntry {
  chatId: string
  title: string
  input: number
  output: number
  costUsd: number
}

export interface WorkspaceStat {
  chatId: string
  title: string
  bytes: number
}

export interface UpdateState {
  status: "idle" | "checking" | "available" | "none" | "downloading" | "ready" | "error"
  version?: string
  percent?: number
  message?: string
}

export type PopdEvent =
  | { type: "engine-status"; status: EngineStatus; detail?: string }
  | { type: "chat-progress"; chatId: string; line: string; elapsedMs: number; detail?: string; reasoning?: string }
  | { type: "chat-warning"; chatId: string; message: string }
  | { type: "chat-question"; chatId: string; question: Question }
  | {
      type: "chat-done"
      chatId: string
      message: string
      artifacts: Artifact[]
      opened?: string
      escalation?: { reason?: string; explanation?: string }
      apiKeyRequest?: ApiKeyRequest
      sanitized?: boolean
    }
  | { type: "chat-error"; chatId: string; message: string; retryable: boolean }
  | { type: "chat-stopped"; chatId: string }
  | { type: "chats-changed" }
  | { type: "library-changed" }
  | { type: "busy-changed"; busy: boolean }
  | { type: "theme-changed"; appearance: "light" | "dark" }
  | { type: "open-chat"; chatId: string }
  | { type: "update-state"; state: UpdateState }

export interface PopdApi {
  getState(): Promise<{
    settings: Settings
    engine: EngineStatus
    chats: ChatSummary[]
    versions: { app: string; rules?: boolean; engine?: string }
    appearance: "light" | "dark"
  }>
  saveSettings(patch: Partial<Settings>): Promise<Settings>
  connectKey(key: string): Promise<{ ok: boolean; error?: string }>
  connectServiceKey(integrationID: string, key: string): Promise<{ ok: boolean; error?: string }>
  checkKey(): Promise<{ ok: boolean; text: string }>
  testPersona(): Promise<{ ok: boolean; text: string }>
  listModels(): Promise<ModelOption[]>
  createChat(title?: string, agent?: string): Promise<ChatSummary>
  renameChat(id: string, title: string): Promise<void>
  pinChat(id: string, pinned: boolean): Promise<void>
  deleteChat(id: string): Promise<void>
  listChats(): Promise<ChatSummary[]>
  getChat(id: string): Promise<{
    chat: ChatSummary
    messages: ChatMessage[]
    artifacts: Artifact[]
    escalation?: { reason?: string; explanation?: string }
    apiKeyRequest?: ApiKeyRequest
  }>
  send(chatId: string, text: string): Promise<void>
  cancelChat(chatId: string): Promise<void>
  answerQuestion(
    chatId: string,
    formId: string,
    answer: Record<string, string | number | boolean | string[]>,
  ): Promise<void>
  openArtifact(path: string): Promise<void>
  showInFolder(path: string): Promise<void>
  openFolder(path: string): Promise<void>
  openExternal(url: string): Promise<void>
  library(): Promise<LibraryEntry[]>
  refreshLibrary(): Promise<LibraryEntry[]>
  mcpList(): Promise<McpServerInfo[]>
  usage(): Promise<UsageEntry[]>
  workspaceStats(): Promise<{ root: string; total: number; chats: WorkspaceStat[] }>
  archiveChat(id: string): Promise<{ ok: boolean; path?: string; error?: string }>
  restoreChat(id: string): Promise<{ ok: boolean; error?: string }>
  logs(): Promise<{ engine: string; plugin: string }>
  updates(): Promise<UpdateState>
  checkUpdates(): Promise<UpdateState>
  downloadUpdate(): Promise<UpdateState>
  installUpdate(): Promise<void>
  exportDiagnostics(): Promise<string | null>
  restartEngine(): Promise<void>
  onEvent(handler: (event: PopdEvent) => void): () => void
  platform: string
}
