import { app } from "electron"
import fs from "node:fs"
import path from "node:path"

export function resourcesDir(): string {
  return app.isPackaged ? process.resourcesPath : path.join(app.getAppPath(), "resources")
}

export function rulesPath(): string {
  return path.join(resourcesDir(), "popd-rules.md")
}

export function pluginDir(): string {
  return path.join(resourcesDir(), "popd-plugin")
}

export function engineBinary(): string {
  const bundled = path.join(
    resourcesDir(),
    "engine",
    process.platform === "win32" ? "opencode.exe" : "opencode",
  )
  if (fs.existsSync(bundled)) return bundled
  return process.platform === "win32" ? "opencode.exe" : "opencode"
}

export function appVersion(): string {
  return app.getVersion()
}
