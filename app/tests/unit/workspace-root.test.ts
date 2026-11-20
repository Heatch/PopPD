import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { SettingsStore } from "../../src/main/settings"
import { ensureLocalWorkspace, isSyncedFolder, workspaceBase } from "../../src/main/workspaceRoot"

function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "popd-root-"))
}

describe("workspace location", () => {
  it("spots cloud-synced folders", () => {
    expect(isSyncedFolder(path.join("C:", "Users", "sam", "OneDrive", "Documents", "PopPD"))).toBe(true)
    expect(isSyncedFolder(path.join("C:", "Users", "sam", "OneDrive - Contoso", "Documents", "PopPD"))).toBe(true)
    expect(isSyncedFolder(path.join("/Users/sam", "Library", "CloudStorage", "Dropbox", "PopPD"))).toBe(true)
    expect(isSyncedFolder(path.join("C:", "Users", "sam", "Dropbox", "PopPD"))).toBe(true)
    expect(isSyncedFolder(path.join("C:", "Users", "sam", "PopPD"))).toBe(false)
  })

  it("keeps a fresh install local when Documents is synced", () => {
    expect(workspaceBase(path.join("C:", "Users", "sam", "OneDrive", "Documents"), path.join("C:", "Users", "sam"))).toBe(
      path.join("C:", "Users", "sam"),
    )
    expect(workspaceBase(path.join("C:", "Users", "sam", "Documents"), path.join("C:", "Users", "sam"))).toBe(
      path.join("C:", "Users", "sam", "Documents"),
    )
  })

  it("moves an existing synced workspace once and rewrites chat paths", () => {
    const base = tempDir()
    const home = tempDir()
    const docs = path.join(home, "OneDrive", "Documents")
    const root = path.join(docs, "PopPD")
    const workspace = path.join(root, "a-timer")
    fs.mkdirSync(workspace, { recursive: true })
    fs.writeFileSync(path.join(workspace, "index.html"), "<!doctype html>")
    const chatsFile = path.join(base, "chats.json")
    fs.writeFileSync(
      chatsFile,
      JSON.stringify([{ id: "1", title: "Timer", workspace, createdAt: 1, updatedAt: 1 }]),
    )
    const settings = new SettingsStore(base, docs)
    settings.save({ workspaceRoot: root })

    expect(ensureLocalWorkspace({ settings, chatsFile, homeDir: home })).toBe(true)
    const target = path.join(home, "PopPD")
    expect(fs.existsSync(path.join(target, "a-timer", "index.html"))).toBe(true)
    expect(settings.get().workspaceRoot).toBe(target)
    const chats = JSON.parse(fs.readFileSync(chatsFile, "utf8"))
    expect(chats[0].workspace).toBe(path.join(target, "a-timer"))
    // The engine session remembered the old folder, so it is dropped.
    expect(chats[0].sessionID).toBeUndefined()
  })

  it("leaves a local workspace alone", () => {
    const base = tempDir()
    const home = tempDir()
    const settings = new SettingsStore(base, home)
    settings.save({ workspaceRoot: path.join(home, "PopPD") })

    expect(ensureLocalWorkspace({ settings, chatsFile: path.join(base, "chats.json"), homeDir: home })).toBe(false)
    expect(settings.get().workspaceRoot).toBe(path.join(home, "PopPD"))
  })
})
