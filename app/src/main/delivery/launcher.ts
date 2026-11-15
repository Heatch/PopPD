import fs from "node:fs"
import path from "node:path"

export interface Deliverable {
  path: string
  kind?: string
}

export function walk(dir: string): string[] {
  const out: string[] = []
  const stack = [dir]
  while (stack.length) {
    const current = stack.pop()!
    let entries: fs.Dirent[] = []
    try {
      entries = fs.readdirSync(current, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      if (entry.name === "node_modules" || entry.name === ".git" || entry.name.startsWith(".")) continue
      const full = path.join(current, entry.name)
      if (entry.isDirectory()) stack.push(full)
      else out.push(full)
    }
  }
  return out.sort()
}

function mainHtml(files: string[]): string | undefined {
  const html = files.filter((file) => /\.html?$/i.test(file))
  return html.sort((a, b) => {
    const score = (file: string) => {
      const name = path.basename(file).toLowerCase()
      if (name === "index.html") return 3
      if (/app|main|pomodoro|chores/.test(name)) return 2
      return 1
    }
    return score(b) - score(a)
  })[0]
}

/** Marker written by the plugin's deliver_artifact tool. */
export function readDeliverable(dir: string): Deliverable | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(dir, ".popd-deliverable.json"), "utf8"))
    if (!parsed?.path) return null
    const resolved = path.resolve(dir, String(parsed.path))
    const root = path.resolve(dir)
    if (resolved !== root && !resolved.startsWith(root + path.sep)) return null
    if (!fs.existsSync(resolved)) return null
    return { path: resolved, kind: parsed.kind ? String(parsed.kind) : undefined }
  } catch {
    return null
  }
}

export function readApiKeyRequest(
  dir: string,
): { service: string; url?: string; why?: string } | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(dir, ".popd-api-key-request.json"), "utf8"))
    if (!parsed?.service) return null
    return {
      service: String(parsed.service),
      url: parsed.url ? String(parsed.url) : undefined,
      why: parsed.why ? String(parsed.why) : undefined,
    }
  } catch {
    return null
  }
}

/** Moves leftover scaffolding (leading underscore) into _work/ so the folder stays clean. */
export function sweepScaffolding(dir: string): number {
  let moved = 0
  let entries: fs.Dirent[] = []
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return 0
  }
  for (const entry of entries) {
    if (!entry.name.startsWith("_") || entry.name === "_work") continue
    const from = path.join(dir, entry.name)
    const toDir = path.join(dir, "_work")
    try {
      fs.mkdirSync(toDir, { recursive: true })
      fs.renameSync(from, path.join(toDir, entry.name))
      moved++
    } catch {
      // leave it in place if it cannot be moved
    }
  }
  return moved
}

/** Escapes a filename for use inside a quoted `start` argument in a .bat file. */
export function batEscape(name: string): string {
  return name.replace(/[\r\n"]/g, "").replace(/%/g, "%%")
}

/**
 * The shell-side last-mile guarantee: always leave an `Open this.bat` pointing at the
 * main delivery (web page, PDF, sheet, image, video…). The model is not relied on.
 */
export function ensureLauncher(dir: string): { path: string; auto: boolean } | null {
  const files = walk(dir)
  const existing = files.find((file) => /^open this\.(bat|cmd|command)$/i.test(path.basename(file)))
  if (existing) return { path: existing, auto: false }
  const target = mainArtifactPath(dir)
  if (!target) return null
  const launcher = path.join(dir, "Open this.bat")
  fs.writeFileSync(launcher, `@echo off\r\nstart "" "%~dp0${batEscape(path.basename(target))}"\r\n`)
  return { path: launcher, auto: true }
}

export function mainArtifactPath(dir: string): string | null {
  const marked = readDeliverable(dir)
  if (marked) return marked.path
  const files = walk(dir)
  const html = mainHtml(files)
  if (html) return html
  return (
    files.find((file) =>
      /\.(pdf|png|jpe?g|webp|svg|xlsx|csv|pptx|docx|mp4|mov|webm|mp3|wav)$/i.test(file),
    ) ?? null
  )
}
