import { app, BrowserWindow, Menu, Notification } from "electron"
import fs from "node:fs"
import path from "node:path"
import { ChatManager } from "./chats"
import { MockBackend } from "./backend/mock"
import { OpenCodeBackend } from "./backend/opencode"
import type { Backend } from "./backend/types"
import { buildEngineConfig } from "./engine/config"
import { EngineSupervisor } from "./engine/supervisor"
import { engineBinary, pluginDir, rulesPath } from "./resources"
import { SettingsStore } from "./settings"
import { registerIpc } from "./ipc"
import { Library } from "./library"
import { ElectronThumbnailer } from "./library/thumbnailer"
import { Updates } from "./updates"
import type { PopdEvent } from "../shared/types"

if (process.env.POPD_USER_DATA) app.setPath("userData", process.env.POPD_USER_DATA)
app.setAppUserModelId("dev.popd.app")

let window: BrowserWindow | null = null
let backend: Backend | null = null
let chats: ChatManager | null = null
let library: Library | null = null
let settingsRef: SettingsStore | null = null

function emitRaw(event: PopdEvent) {
  if (window && !window.isDestroyed()) window.webContents.send("popd:event", event)
}

function emit(event: PopdEvent) {
  emitRaw(event)
  if (event.type === "chat-done") {
    const chatId = event.chatId
    void (async () => {
      if (library && chats) await library.refresh(chats.list()).catch(() => {})
      emitRaw({ type: "library-changed" })
    })()

    if (settingsRef?.get().notifications && window && !window.isFocused() && Notification.isSupported()) {
      const title = chats?.find(chatId)?.title ?? "Your result"
      const notification = new Notification({
        title: `Ready: ${title}`,
        body: event.message.slice(0, 140),
      })
      notification.on("click", () => {
        window?.show()
        window?.focus()
        emitRaw({ type: "open-chat", chatId })
      })
      notification.show()
    }
  }
}

function createWindow() {
  window = new BrowserWindow({
    width: 1180,
    height: 820,
    minWidth: 900,
    minHeight: 620,
    backgroundColor: "#f7f2e8",
    title: "PopPD",
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  window.once("ready-to-show", () => window?.show())
  window.on("closed", () => {
    window = null
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void window.loadFile(path.join(__dirname, "../renderer/index.html"))
  }
}

function readTail(file: string, bytes = 20_000): string {
  try {
    return fs.readFileSync(file, "utf8").slice(-bytes)
  } catch {
    return ""
  }
}

async function bootstrap() {
  Menu.setApplicationMenu(null)

  const documents = process.env.POPD_DOCUMENTS ?? app.getPath("documents")
  const settings = new SettingsStore(app.getPath("userData"), documents)
  if (process.env.POPD_WORKSPACE) settings.save({ workspaceRoot: process.env.POPD_WORKSPACE })
  settingsRef = settings

  const logDir = path.join(app.getPath("userData"), "logs")
  const mock = process.env.POPD_MOCK === "1"
  const supervisor = new EngineSupervisor({
    binary: engineBinary(),
    config: buildEngineConfig({
      model: settings.get().model,
      rulesPath: rulesPath(),
      pluginPath: pluginDir(),
      allowMcp: settings.get().allowMcp,
      mcpServers: settings.get().mcpServers,
    }),
    logDir,
  })

  backend = mock ? new MockBackend() : new OpenCodeBackend(supervisor)
  const selected = backend

  library = new Library({
    indexPath: path.join(app.getPath("userData"), "library.json"),
    thumbnailer: new ElectronThumbnailer(path.join(app.getPath("userData"), "thumbs")),
  })

  const updates = new Updates((state) => emitRaw({ type: "update-state", state }))

  chats = new ChatManager({
    backend: selected,
    settings,
    indexPath: path.join(app.getPath("userData"), "chats.json"),
    logDir,
    emit,
  })

  supervisor.on("status", (status: string, detail?: string) => {
    emit({ type: "engine-status", status: status as any, detail })
  })

  registerIpc({
    settings,
    backend: selected,
    chats,
    supervisor,
    library,
    updates,
    emit,
    getLogs: () => ({
      engine: supervisor.logs || readTail(path.join(logDir, "engine.log")),
      plugin: readTail(path.join(logDir, "plugin.log")),
    }),
  })

  createWindow()

  selected.start().catch((error) => {
    emit({
      type: "engine-status",
      status: "error",
      detail: error instanceof Error ? error.message : String(error),
    })
  })
}

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on("second-instance", () => {
    if (window) {
      if (window.isMinimized()) window.restore()
      window.focus()
    }
  })

  app.whenReady().then(bootstrap).catch((error) => {
    console.error("PopPD failed to start", error)
  })

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit()
  })

  app.on("before-quit", () => {
    chats?.stopAll()
    void backend?.stop()
  })
}
