import fs from "node:fs"
import path from "node:path"

/**
 * Crash-safe JSON. Writes go to a temp file first and keep a .bak of the previous
 * good copy; reads fall back to the backup if the main file is corrupt.
 */
export function readJson<T>(file: string, fallback: T): T {
  for (const candidate of [file, `${file}.bak`]) {
    try {
      return JSON.parse(fs.readFileSync(candidate, "utf8")) as T
    } catch {
      // try the next candidate
    }
  }
  return fallback
}

export function writeJson(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const temp = `${file}.tmp`
  fs.writeFileSync(temp, JSON.stringify(value, null, 2))
  try {
    if (fs.existsSync(file)) fs.copyFileSync(file, `${file}.bak`)
  } catch {
    // a missing backup is not fatal
  }
  fs.renameSync(temp, file)
}
