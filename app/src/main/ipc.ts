import { app, BrowserWindow, ipcMain, nativeTheme, shell } from "electron"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import type { LibraryEntry, ChatSummary, PopdEvent, Settings } from "../shared/types"
import type { Backend } from "./backend/types"
import type { ChatManager } from "./chats"
import { openExternal, openPath, showInFolder } from "./delivery/shell"
import { readApiKeyRequest, walk } from "./delivery/launcher"
import { listArtifacts } from "./delivery/artifacts"
import { writeDiagnostics } from "./diagnostics"
import { buildEngineConfig } from "./engine/config"
import { probePersona, rulesFileLooksValid } from "./engine/persona"
import type { EngineSupervisor } from "./engine/supervisor"
import type { Library } from "./library"
import { appVersion, engineBinary, pluginDir, rulesPath } from "./resources"
import type { SettingsStore } from "./settings"
import type { Updates } from "./updates"

export interface IpcDeps {
  settings: SettingsStore
  backend: Backend
  chats: ChatManager
  supervisor: EngineSupervisor
  library: Library
  updates: Updates
  emit: (event: PopdEvent) => void
  getLogs: () => { engine: string; plugin: string }
}

function dataUrl(file: string): string | null {
  try {
    return `data:image/png;base64,${fs.readFileSync(file).toString("base64")}`
  } catch {
    return null
  }
}

function dirSize(dir: string): number {
  let total = 0
  for (const file of walk(dir)) {
    try {
      total += fs.statSync(file).size
    } catch {
      // ignore
    }
  }
  return total
}

export function registerIpc(deps: IpcDeps) {
  const { settings, backend, chats, supervisor, library, updates, emit, getLogs } = deps

  // The most recent archive, so the person can undo it from the toast.
  let lastArchived: { chat: ChatSummary; path: string } | null = null

  const config = () =>
    buildEngineConfig({
      model: settings.get().model,
      rulesPath: rulesPath(),
      pluginPath: pluginDir(),
      allowMcp: settings.get().allowMcp,
      mcpServers: settings.get().mcpServers,
    })

  const insideWorkspace = (target: string) => {
    const resolved = path.resolve(target)
    return chats.list().some((chat) => {
      const workspace = path.resolve(chat.workspace)
      return resolved === workspace || resolved.startsWith(workspace + path.sep)
    })
  }

  const refreshLibrary = async (): Promise<LibraryEntry[]> => {
    const entries = await library.refresh(chats.list())
    return entries.map((entry) => ({
      ...entry,
      thumb: entry.thumb ? dataUrl(entry.thumb) : null,
    }))
  }

  ipcMain.handle("popd:state", () => ({
    settings: settings.get(),
    engine: backend.status(),
    chats: chats.list(),
    versions: {
      app: appVersion(),
      rules: rulesFileLooksValid(rulesPath()).ok,
      engine: supervisor.engineVersion,
    },
    appearance: nativeTheme.shouldUseDarkColors ? "dark" : "light",
  }))

  ipcMain.handle("popd:settings:save", async (_event, patch: Partial<Settings>) => {
    const before = settings.get()
    const next = settings.save(patch)
    if (next.theme !== before.theme) {
      nativeTheme.themeSource = next.theme
      const background = nativeTheme.shouldUseDarkColors ? "#191715" : "#f7f2e8"
      for (const window of BrowserWindow.getAllWindows()) window.setBackgroundColor(background)
    }
    const restartNeeded =
      before.model !== next.model ||
      before.allowMcp !== next.allowMcp ||
      JSON.stringify(before.mcpServers) !== JSON.stringify(next.mcpServers)
    if (restartNeeded) {
      supervisor.updateConfig(config())
      await backend.restart().catch(() => {})
    }
    return next
  })

  ipcMain.handle("popd:connect-key", async (_event, key: string) => {
    try {
      await backend.connectKey(key)
      return { ok: true }
    } catch (error) {
      return { ok: false, error: (error as Error)?.message ?? String(error) }
    }
  })

  ipcMain.handle("popd:connect-service-key", async (_event, integrationID: string, key: string) => {
    try {
      await backend.connectIntegration(integrationID, key)
      return { ok: true }
    } catch (error) {
      return { ok: false, error: (error as Error)?.message ?? String(error) }
    }
  })

  ipcMain.handle("popd:key:check", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "popd-keycheck-"))
    try {
      const sessionID = await backend.createSession({
        title: "Key check",
        directory: dir,
        model: settings.get().model,
      })
      await backend.prompt(sessionID, "Reply with exactly: OK")
      const started = Date.now()
      while (Date.now() - started < 60_000) {
        const state = await backend.session(sessionID)
        if (state.outcome) {
          return state.outcome === "succeeded"
            ? { ok: true, text: "Your key works." }
            : { ok: false, text: "The key was rejected." }
        }
        await new Promise((resolve) => setTimeout(resolve, 1500))
      }
      return { ok: false, text: "The check timed out." }
    } catch (error) {
      return { ok: false, text: (error as Error)?.message ?? String(error) }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  ipcMain.handle("popd:test-persona", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "popd-check-"))
    try {
      return await probePersona(backend, dir, settings.get().model)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  ipcMain.handle("popd:models", () => backend.listModels())
  ipcMain.handle("popd:chats:list", () => chats.list())
  ipcMain.handle("popd:chats:create", (_event, title?: string, agent?: string) => chats.create(title, agent))
  ipcMain.handle("popd:chats:rename", (_event, id: string, title: string) => chats.rename(id, title))
  ipcMain.handle("popd:chats:pin", (_event, id: string, pinned: boolean) => chats.setPinned(id, pinned))
  ipcMain.handle("popd:chats:delete", async (_event, id: string) => {
    const chat = chats.find(id)
    if (!chat) return
    await chats.remove(id)
    try {
      await shell.trashItem(chat.workspace)
    } catch {
      // if the trash is unavailable the folder simply stays
    }
  })
  ipcMain.handle("popd:chats:get", async (_event, id: string) => {
    const chat = chats.find(id)
    if (!chat) throw new Error("Unknown chat")
    let escalation: { reason?: string; explanation?: string } | undefined
    try {
      escalation = JSON.parse(
        fs.readFileSync(path.join(chat.workspace, "popd-escalation.json"), "utf8"),
      )
    } catch {
      escalation = undefined
    }
    return {
      chat,
      messages: await chats.messages(id),
      artifacts: listArtifacts(chat.workspace),
      escalation,
      apiKeyRequest: readApiKeyRequest(chat.workspace) ?? undefined,
    }
  })
  ipcMain.handle("popd:chats:send", (_event, chatId: string, text: string) => chats.send(chatId, text))
  ipcMain.handle("popd:chats:cancel", (_event, chatId: string) => chats.cancel(chatId))
  ipcMain.handle(
    "popd:chats:answer",
    (_event, chatId: string, formId: string, answer: Record<string, string | number | boolean | string[]>) =>
      chats.answer(chatId, formId, answer),
  )
  ipcMain.handle("popd:chats:usage", () => chats.usage())

  ipcMain.handle("popd:artifact:open", (_event, target: string) => {
    if (insideWorkspace(target) && fs.existsSync(target)) return openPath(target)
  })
  ipcMain.handle("popd:artifact:show", (_event, target: string) => {
    if (insideWorkspace(target) && fs.existsSync(target)) showInFolder(target)
  })
  ipcMain.handle("popd:folder:open", (_event, target: string) => {
    const root = path.resolve(settings.get().workspaceRoot)
    const resolved = path.resolve(target)
    if ((resolved === root || resolved.startsWith(root + path.sep)) && fs.existsSync(resolved)) {
      return openPath(resolved)
    }
  })
  ipcMain.handle("popd:open-external", (_event, url: string) => openExternal(url))

  ipcMain.handle("popd:library:list", () => refreshLibrary())
  ipcMain.handle("popd:library:refresh", () => refreshLibrary())

  ipcMain.handle("popd:mcp:list", () => backend.listMcp(settings.get().workspaceRoot))

  ipcMain.handle("popd:workspace:stats", () => {
    const rows = chats.list().map((chat) => ({
      chatId: chat.id,
      title: chat.title,
      bytes: dirSize(chat.workspace),
    }))
    return {
      root: settings.get().workspaceRoot,
      total: rows.reduce((sum, row) => sum + row.bytes, 0),
      chats: rows,
    }
  })

  ipcMain.handle("popd:workspace:archive", async (_event, chatId: string) => {
    const chat = chats.find(chatId)
    if (!chat) return { ok: false, error: "Unknown chat" }
    try {
      const archiveRoot = path.join(
        process.env.POPD_DOCUMENTS ?? app.getPath("documents"),
        "PopPD Archive",
      )
      fs.mkdirSync(archiveRoot, { recursive: true })
      const target = path.join(archiveRoot, `${path.basename(chat.workspace)}-${Date.now()}`)
      fs.renameSync(chat.workspace, target)
      await chats.remove(chatId)
      lastArchived = { chat: { ...chat, workspace: target }, path: target }
      return { ok: true, path: target }
    } catch (error) {
      return { ok: false, error: (error as Error)?.message ?? String(error) }
    }
  })

  ipcMain.handle("popd:workspace:restore", async (_event, chatId: string) => {
    if (!lastArchived || lastArchived.chat.id !== chatId) {
      return { ok: false, error: "That archive is no longer available." }
    }
    const { chat, path: archived } = lastArchived
    try {
      const root = settings.get().workspaceRoot
      fs.mkdirSync(root, { recursive: true })
      const base = path.join(root, path.basename(archived).replace(/-\d+$/, ""))
      let target = base
      for (let n = 2; fs.existsSync(target); n++) target = `${base}-${n}`
      fs.renameSync(archived, target)
      chats.adopt({ ...chat, workspace: target, updatedAt: Date.now() })
      lastArchived = null
      emit({ type: "library-changed" })
      return { ok: true }
    } catch (error) {
      return { ok: false, error: (error as Error)?.message ?? String(error) }
    }
  })

  ipcMain.handle("popd:logs", () => getLogs())

  ipcMain.handle("popd:updates:state", () => updates.get())
  ipcMain.handle("popd:updates:check", () => updates.check())
  ipcMain.handle("popd:updates:download", () => updates.download())
  ipcMain.handle("popd:updates:install", () => {
    updates.install()
  })

  ipcMain.handle("popd:engine:restart", async () => {
    supervisor.updateConfig(config())
    await backend.restart()
  })

  ipcMain.handle("popd:diagnostics", () => {
    const logs = getLogs()
    return writeDiagnostics({
      settings: settings.get(),
      chats: chats.list(),
      library: library.list(),
      updates: updates.get(),
      versions: { app: appVersion(), engine: supervisor.engineVersion, rules: rulesFileLooksValid(rulesPath()).ok },
      engineLogs: logs.engine,
      pluginLogs: logs.plugin,
      crash: undefined,
    })
  })

  ipcMain.handle("popd:emit-ping", () => emit({ type: "chats-changed" }))
}
