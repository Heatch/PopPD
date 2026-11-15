import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { SettingsStore, DEFAULT_MODEL, defaultSettings } from "../../src/main/settings"

const dirs: string[] = []
function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "popd-settings-"))
  dirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

describe("settings", () => {
  it("starts with the fast model, auto-open and a Documents folder", () => {
    const docs = tempDir()
    const store = new SettingsStore(tempDir(), docs)
    const settings = store.get()
    expect(settings.model).toBe(DEFAULT_MODEL)
    expect(settings.autoOpen).toBe(true)
    expect(settings.allowMcp).toBe(false)
    expect(settings.workspaceRoot).toBe(path.join(docs, "PopPD"))
  })

  it("persists changes across instances", () => {
    const base = tempDir()
    const docs = tempDir()
    const first = new SettingsStore(base, docs)
    first.save({ model: "opencode-go/deepseek-v4-pro", onboarded: true })
    const second = new SettingsStore(base, docs)
    expect(second.get().model).toBe("opencode-go/deepseek-v4-pro")
    expect(second.get().onboarded).toBe(true)
  })

  it("tolerates a corrupt settings file", () => {
    const base = tempDir()
    fs.writeFileSync(path.join(base, "settings.json"), "{not json")
    const store = new SettingsStore(base, tempDir())
    expect(store.get().model).toBe(DEFAULT_MODEL)
  })

  it("exposes the defaults helper", () => {
    expect(defaultSettings("C:/docs").workspaceRoot).toBe(path.join("C:/docs", "PopPD"))
  })
})
