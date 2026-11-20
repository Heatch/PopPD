import fs from "node:fs"
import path from "node:path"
import type { ChatSummary } from "../shared/types"
import type { SettingsStore } from "./settings"
import { readJson, writeJson } from "./storage"

// Cloud-synced folders lock files and break file watchers. PopPD keeps its
// workspaces on a plain local folder and never silently merges two of them.
const SYNCED = /(^|[\\/])(OneDrive(?: - [^\\/]+)?|Dropbox|Google Drive|iCloud Drive|Box)([\\/]|$)/i

export function isSyncedFolder(target: string): boolean {
  return SYNCED.test(target)
}

/** Where a fresh install should keep its things. */
export function workspaceBase(documentsDir: string, homeDir: string): string {
  return isSyncedFolder(documentsDir) ? homeDir : documentsDir
}

/**
 * Moves an existing workspace out of a cloud folder, once, before chats are read.
 * A same-volume rename is instant; if anything is locked we leave it alone.
 */
export function ensureLocalWorkspace(options: {
  settings: SettingsStore
  chatsFile: string
  homeDir: string
}): boolean {
  const root = options.settings.get().workspaceRoot
  if (!isSyncedFolder(root)) return false

  const target = path.join(options.homeDir, "PopPD")
  try {
    if (fs.existsSync(root)) {
      // Two PopPD folders would make it unclear which files are current.
      if (fs.existsSync(target)) return false
      fs.renameSync(root, target)
    }
    if (!fs.existsSync(target)) fs.mkdirSync(target, { recursive: true })

    const chats = readJson<ChatSummary[]>(options.chatsFile, [])
    if (Array.isArray(chats)) {
      writeJson(
        options.chatsFile,
        chats.map((chat) => {
          if (!chat.workspace?.startsWith(root)) return chat
          // The engine session remembers its old folder; start a fresh one here.
          const { sessionID: _sessionID, ...rest } = chat
          return { ...rest, workspace: path.join(target, chat.workspace.slice(root.length)) }
        }),
      )
    }
    options.settings.save({ workspaceRoot: target })
    return true
  } catch {
    return false
  }
}
