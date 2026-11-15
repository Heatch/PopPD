import fs from "node:fs"
import path from "node:path"

export function slugify(input: string): string {
  const slug = input
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48)
  return slug || "new-idea"
}

/** Creates Documents/PopPD/<slug>, never reusing a folder that has content. */
export function ensureWorkspace(root: string, title: string): string {
  fs.mkdirSync(root, { recursive: true })
  const base = slugify(title)
  for (let n = 1; n < 200; n++) {
    const candidate = path.join(root, n === 1 ? base : `${base}-${n}`)
    if (!fs.existsSync(candidate)) {
      fs.mkdirSync(candidate, { recursive: true })
      return candidate
    }
    if (fs.readdirSync(candidate).length === 0) return candidate
  }
  const fallback = path.join(root, `${base}-${Date.now()}`)
  fs.mkdirSync(fallback, { recursive: true })
  return fallback
}
