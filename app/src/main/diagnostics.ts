import { app } from "electron"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import type { ChatSummary, LibraryEntry, Settings, UpdateState } from "../shared/types"

export interface DiagnosticsData {
  settings?: Settings
  chats?: ChatSummary[]
  library?: LibraryEntry[]
  updates?: UpdateState
  versions?: { app: string; engine?: string; rules?: boolean }
  engineLogs?: string
  pluginLogs?: string
  crash?: string
}

export function writeDiagnostics(data: DiagnosticsData): string {
  const target = path.join(app.getPath("documents"), `PopPD-diagnostics-${Date.now()}.json`)
  fs.writeFileSync(
    target,
    JSON.stringify(
      {
        at: new Date().toISOString(),
        app: app.getVersion(),
        platform: { os: process.platform, release: os.release(), arch: process.arch },
        ...data,
      },
      null,
      2,
    ),
  )
  return target
}
