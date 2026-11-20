import fs from "node:fs"
import path from "node:path"
import type { Settings } from "../shared/types"
import { readJson, writeJson } from "./storage"

export const DEFAULT_MODEL = "opencode-go/deepseek-v4.1-flash"

export function defaultSettings(documentsDir: string): Settings {
  return {
    onboarded: false,
    model: DEFAULT_MODEL,
    workspaceRoot: path.join(documentsDir, "PopPD"),
    autoOpen: true,
    notifications: true,
    theme: "system",
    allowMcp: false,
    mcpServers: {},
  }
}

export class SettingsStore {
  private file: string
  private value: Settings

  constructor(baseDir: string, documentsDir: string) {
    this.file = path.join(baseDir, "settings.json")
    const defaults = defaultSettings(documentsDir)
    const stored = readJson<Partial<Settings>>(this.file, {})
    this.value = { ...defaults, ...stored, mcpServers: { ...defaults.mcpServers, ...(stored.mcpServers ?? {}) } }
  }

  get(): Settings {
    return this.value
  }

  save(patch: Partial<Settings>): Settings {
    this.value = { ...this.value, ...patch }
    writeJson(this.file, this.value)
    return this.value
  }

  filePath(): string {
    return this.file
  }
}
