import {
  app,
  BrowserWindow,
  Menu,
  Notification,
  Tray,
  nativeImage,
  powerSaveBlocker,
  session,
  dialog,
  shell,
} from "electron"
import fs from "node:fs"
import path from "node:path"
import { ChatManager } from "./chats"
import { MockBackend } from "./backend/mock"
import { OpenCodeBackend } from "./backend/opencode"
import type { Backend } from "./backend/types"
import { buildEngineConfig } from "./engine/config"
import { EngineSupervisor } from "./engine/supervisor"
import { engineBinary, pluginDir, resourcesDir, rulesPath } from "./resources"
import { SettingsStore } from "./settings"
import { registerIpc } from "./ipc"
import { Library } from "./library"
import { ElectronThumbnailer } from "./library/thumbnailer"
import { Updates } from "./updates"
import { writeDiagnostics } from "./diagnostics"
import type { PopdEvent } from "../shared/types"

if (process.env.POPD_USER_DATA) app.setPath("userData", process.env.POPD_USER_DATA)
app.setAppUserModelId("dev.popd.app")

let window: BrowserWindow | null = null
let backend: Backend | null = null
let chats: ChatManager | null = null
let library: Library | null = null
let updates: Updates | null = null
let settingsRef: SettingsStore | null = null
let supervisorRef: EngineSupervisor | null = null
let logDirRef = ""

let tray: Tray | null = null
let blockerId: number | null = null
let busy = false
let isQuitting = false
let workingNotified = false
let crashShown = false

function trayIcon() {
  try {
    return nativeImage.createFromPath(path.join(resourcesDir(), "icon.png")).resize({ width: 16, height: 16 })
  } catch {
    return nativeImage.createEmpty()
  }
}

function showWindow() {
  if (!window) return
  if (!window.isVisible()) window.show()
  if (window.isMinimized()) window.restore()
  window.focus()
}

function setBusy(next: boolean) {
  if (next === busy) return
  busy = next
  if (busy) {
    workingNotified = false
    if (!tray) {
      tray = new Tray(trayIcon())
      tray.setToolTip("PopPD — working…")
      tray.setContextMenu(
        Menu.buildFromTemplate([
          { label: "Open PopPD", click: showWindow },
          { type: "separator" },
          { label: "Quit", click: () => void quitApp() },
        ]),
      )
      tray.on("click", showWindow)
    }
    if (blockerId === null) blockerId = powerSaveBlocker.start("prevent-app-suspension")
    if (window) window.setTitle("PopPD — working…")
  } else {
    if (tray) {
      tray.destroy()
      tray = null
    }
    if (blockerId !== null) {
      powerSaveBlocker.stop(blockerId)
      blockerId = null
    }
    if (window) window.setTitle("PopPD")
  }
}

async function quitApp() {
  if (busy) {
    const { response } = await dialog.showMessageBox({
      type: "warning",
      title: "PopPD",
      message: "A task is still running. Quit anyway?",
      detail: "Quitting stops it. Your files stay where they are.",
      buttons: ["Keep working", "Quit anyway"],
      defaultId: 0,
      cancelId: 0,
    })
    if (response !== 1) return
  }
  isQuitting = true
  app.quit()
}

function emitRaw(event: PopdEvent) {
  if (window && !window.isDestroyed()) window.webContents.send("popd:event", event)
}

function emit(event: PopdEvent) {
  emitRaw(event)

  if (event.type === "busy-changed") {
    setBusy(event.busy)
    return
  }

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
        showWindow()
        emitRaw({ type: "open-chat", chatId })
      })
      notification.show()
    }
  }
}

function readTail(file: string, bytes = 20_000): string {
  try {
    return fs.readFileSync(file, "utf8").slice(-bytes)
  } catch {
    return ""
  }
}

function installCrashHandlers() {
  const report = (label: string, error: unknown) => {
    if (crashShown) return
    crashShown = true
    const text = error instanceof Error ? (error.stack ?? error.message) : String(error)
    try {
      const dir = path.join(app.getPath("userData"), "logs")
      fs.mkdirSync(dir, { recursive: true })
      fs.appendFileSync(path.join(dir, "crash.log"), `\n[${new Date().toISOString()}] ${label}\n${text}\n`)
    } catch {
      // nothing else to do
    }
    void dialog
      .showMessageBox({
        type: "error",
        title: "PopPD hit a snag",
        message: "Something went wrong, but your files are safe.",
        detail: "You can export diagnostics and send them to whoever set PopPD up.",
        buttons: ["Export diagnostics", "Close"],
        defaultId: 0,
        cancelId: 1,
      })
      .then(({ response }) => {
        if (response !== 0) return
        try {
          const target = writeDiagnostics({
            settings: settingsRef?.get(),
            chats: chats?.list(),
            library: library?.list(),
            updates: updates?.get(),
            versions: { app: app.getVersion(), engine: supervisorRef?.engineVersion },
            engineLogs: supervisorRef?.logs,
            pluginLogs: readTail(path.join(logDirRef, "plugin.log")),
            crash: text,
          })
          shell.showItemInFolder(target)
        } catch {
          // if this fails there is nothing more to offer
        }
      })
  }

  process.on("uncaughtException", (error) => report("uncaughtException", error))
  process.on("unhandledRejection", (error) => report("unhandledRejection", error))
  app.on("render-process-gone", (_event, _contents, details) => report("render-process-gone", details.reason))
}

function createWindow() {
  window = new BrowserWindow({
    width: 1180,
    height: 820,
    minWidth: 900,
    minHeight: 620,
    backgroundColor: "#f7f2e8",
    title: "PopPD",
    icon: path.join(resourcesDir(), "icon-256.png"),
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  })

  window.once("ready-to-show", () => window?.show())
  window.on("close", (event) => {
    if (isQuitting) return
    if (busy) {
      event.preventDefault()
      window?.hide()
      if (!workingNotified && settingsRef?.get().notifications && Notification.isSupported()) {
        workingNotified = true
        const notification = new Notification({
          title: "Still working",
          body: "You can close this window — I'll tell you when it's ready.",
        })
        notification.on("click", showWindow)
        notification.show()
      }
    }
  })
  window.on("closed", () => {
    window = null
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void window.loadFile(path.join(__dirname, "../renderer/index.html"))
  }
}

async function bootstrap() {
  Menu.setApplicationMenu(null)

  const documents = process.env.POPD_DOCUMENTS ?? app.getPath("documents")
  const settings = new SettingsStore(app.getPath("userData"), documents)
  if (process.env.POPD_WORKSPACE) settings.save({ workspaceRoot: process.env.POPD_WORKSPACE })
  settingsRef = settings

  const logDir = path.join(app.getPath("userData"), "logs")
  logDirRef = logDir
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
  supervisorRef = supervisor

  backend = mock ? new MockBackend() : new OpenCodeBackend(supervisor)
  const selected = backend

  library = new Library({
    indexPath: path.join(app.getPath("userData"), "library.json"),
    thumbnailer: new ElectronThumbnailer(path.join(app.getPath("userData"), "thumbs")),
  })

  updates = new Updates((state) => emitRaw({ type: "update-state", state }))

  chats = new ChatManager({
    backend: selected,
    settings,
    indexPath: path.join(app.getPath("userData"), "chats.json"),
    logDir,
    emit,
  })
  const chatManager = chats

  supervisor.on("status", (status: string, detail?: string) => {
    emit({ type: "engine-status", status: status as any, detail })
  })

  // Content-Security-Policy for the packaged renderer (dev keeps HMR working).
  if (app.isPackaged) {
    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          "Content-Security-Policy": [
            "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'",
          ],
        },
      })
    })
  }

  registerIpc({
    settings,
    backend: selected,
    chats: chatManager,
    supervisor,
    library,
    updates,
    emit,
    getLogs: () => ({
      engine: supervisor.logs || readTail(path.join(logDir, "engine.log")),
      plugin: readTail(path.join(logDir, "plugin.log")),
    }),
  })

  installCrashHandlers()
  createWindow()

  selected
    .start()
    .then(() => chatManager.recover())
    .catch((error) => {
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
    showWindow()
  })

  app.whenReady().then(bootstrap).catch((error) => {
    console.error("PopPD failed to start", error)
  })

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
    else showWindow()
  })

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit()
  })

  app.on("before-quit", () => {
    isQuitting = true
    chats?.stopAll()
    void backend?.stop()
    if (tray) {
      tray.destroy()
      tray = null
    }
    if (blockerId !== null) {
      powerSaveBlocker.stop(blockerId)
      blockerId = null
    }
  })
}
