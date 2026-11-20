import { contextBridge, ipcRenderer } from "electron"
import type { PopdApi, PopdEvent } from "../shared/types"

const api: PopdApi = {
  getState: () => ipcRenderer.invoke("popd:state"),
  saveSettings: (patch) => ipcRenderer.invoke("popd:settings:save", patch),
  connectKey: (key) => ipcRenderer.invoke("popd:connect-key", key),
  connectServiceKey: (integrationID, key) => ipcRenderer.invoke("popd:connect-service-key", integrationID, key),
  checkKey: () => ipcRenderer.invoke("popd:key:check"),
  testPersona: () => ipcRenderer.invoke("popd:test-persona"),
  listModels: () => ipcRenderer.invoke("popd:models"),
  createChat: (title, agent) => ipcRenderer.invoke("popd:chats:create", title, agent),
  renameChat: (id, title) => ipcRenderer.invoke("popd:chats:rename", id, title),
  pinChat: (id, pinned) => ipcRenderer.invoke("popd:chats:pin", id, pinned),
  deleteChat: (id) => ipcRenderer.invoke("popd:chats:delete", id),
  listChats: () => ipcRenderer.invoke("popd:chats:list"),
  getChat: (id) => ipcRenderer.invoke("popd:chats:get", id),
  send: (chatId, text) => ipcRenderer.invoke("popd:chats:send", chatId, text),
  cancelChat: (chatId) => ipcRenderer.invoke("popd:chats:cancel", chatId),
  answerQuestion: (chatId, formId, answer) => ipcRenderer.invoke("popd:chats:answer", chatId, formId, answer),
  openArtifact: (target) => ipcRenderer.invoke("popd:artifact:open", target),
  showInFolder: (target) => ipcRenderer.invoke("popd:artifact:show", target),
  openFolder: (target) => ipcRenderer.invoke("popd:folder:open", target),
  openExternal: (url) => ipcRenderer.invoke("popd:open-external", url),
  library: () => ipcRenderer.invoke("popd:library:list"),
  refreshLibrary: () => ipcRenderer.invoke("popd:library:refresh"),
  mcpList: () => ipcRenderer.invoke("popd:mcp:list"),
  usage: () => ipcRenderer.invoke("popd:chats:usage"),
  workspaceStats: () => ipcRenderer.invoke("popd:workspace:stats"),
  archiveChat: (id) => ipcRenderer.invoke("popd:workspace:archive", id),
  restoreChat: (id) => ipcRenderer.invoke("popd:workspace:restore", id),
  logs: () => ipcRenderer.invoke("popd:logs"),
  updates: () => ipcRenderer.invoke("popd:updates:state"),
  checkUpdates: () => ipcRenderer.invoke("popd:updates:check"),
  downloadUpdate: () => ipcRenderer.invoke("popd:updates:download"),
  installUpdate: () => ipcRenderer.invoke("popd:updates:install"),
  exportDiagnostics: () => ipcRenderer.invoke("popd:diagnostics"),
  restartEngine: () => ipcRenderer.invoke("popd:engine:restart"),
  onEvent: (handler) => {
    const listener = (_event: unknown, payload: PopdEvent) => handler(payload)
    ipcRenderer.on("popd:event", listener as any)
    return () => ipcRenderer.removeListener("popd:event", listener as any)
  },
  platform: process.platform,
}

contextBridge.exposeInMainWorld("popd", api)
