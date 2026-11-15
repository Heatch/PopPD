import fs from "node:fs"
import path from "node:path"
import type { Settings } from "../shared/types"

export const DEFAULT_MODEL = "opencode-go/deepseek-v4.1-flash"

export function defaultSettings(documentsDir: string): Settings {
  return {
    onboarded: false,
    model: DEFAULT_MODEL,
    workspaceRoot: path.join(documentsDir, "PopPD"),
    autoOpen: true,
    notifications: true,
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
    let stored: Partial<Settings> = {}
    try {
      stored = JSON.parse(fs.readFileSync(this.file, "utf8"))
    } catch {
      stored = {}
    }
    this.value = { ...defaults, ...stored, mcpServers: { ...defaults.mcpServers, ...(stored.mcpServers ?? {}) } }
  }

  get(): Settings {
    return this.value
  }

  save(patch: Partial<Settings>): Settings {
    this.value = { ...this.value, ...patch }
    fs.mkdirSync(path.dirname(this.file), { recursive: true })
    fs.writeFileSync(this.file, JSON.stringify(this.value, null, 2))
    return this.value
  }

  filePath(): string {
    return this.file
  }
}
