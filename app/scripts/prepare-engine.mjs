import { execFileSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

// Copies the OpenCode CLI into resources/engine so the installer can bundle it.
// The binary is not committed; set OPENCODE_BIN to override discovery.
const here = path.dirname(fileURLToPath(import.meta.url))
const appRoot = path.resolve(here, "..")
const targetDir = path.join(appRoot, "resources", "engine")
const target = path.join(targetDir, process.platform === "win32" ? "opencode.exe" : "opencode")

function findOnPath(name) {
  try {
    const command = process.platform === "win32" ? "where" : "which"
    const out = execFileSync(command, [name], { encoding: "utf8" }).split(/\r?\n/).filter(Boolean)
    return out[0] ?? null
  } catch {
    return null
  }
}

const source =
  process.env.OPENCODE_BIN ??
  findOnPath(process.platform === "win32" ? "opencode.exe" : "opencode") ??
  findOnPath("opencode")

if (!source || !fs.existsSync(source)) {
  console.error("Could not find the opencode binary. Set OPENCODE_BIN=/path/to/opencode.")
  process.exit(1)
}

fs.mkdirSync(targetDir, { recursive: true })
fs.copyFileSync(source, target)
if (process.platform !== "win32") fs.chmodSync(target, 0o755)
const bytes = fs.statSync(target).size
console.log(`engine: ${source} -> ${target} (${(bytes / 1024 / 1024).toFixed(1)} MB)`)
