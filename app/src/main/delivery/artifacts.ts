import fs from "node:fs"
import path from "node:path"
import type { Artifact, ArtifactKind } from "../../shared/types"
import { walk } from "./launcher"

const KINDS: Record<string, ArtifactKind> = {
  html: "web",
  htm: "web",
  png: "image",
  jpg: "image",
  jpeg: "image",
  gif: "image",
  webp: "image",
  avif: "image",
  svg: "svg",
  mp4: "video",
  mov: "video",
  webm: "video",
  mp3: "audio",
  wav: "audio",
  m4a: "audio",
  pdf: "pdf",
  xlsx: "sheet",
  xls: "sheet",
  csv: "sheet",
  pptx: "slides",
  ppt: "slides",
  docx: "doc",
  doc: "doc",
  txt: "text",
  md: "text",
  json: "text",
}

const ORDER: ArtifactKind[] = ["web", "image", "svg", "pdf", "sheet", "slides", "doc", "video", "audio", "text", "other"]

export function artifactKind(file: string): ArtifactKind {
  const ext = path.extname(file).slice(1).toLowerCase()
  return KINDS[ext] ?? "other"
}

/** Files the user should see. Scaffolding (underscore), launchers and dotfiles are hidden. */
export function listArtifacts(dir: string, limit = 60): Artifact[] {
  const files = walk(dir)
    .filter((file) => {
      const name = path.basename(file)
      if (name.startsWith("_")) return false
      if (/^open this\.(bat|cmd|command)$/i.test(name)) return false
      if (path.dirname(file).split(path.sep).some((part) => part.startsWith("_"))) return false
      return true
    })
    .map((file) => ({
      path: file,
      name: path.basename(file),
      kind: artifactKind(file),
      bytes: fs.statSync(file).size,
    }))
    .sort((a, b) => {
      const rank = (artifact: Artifact) => ORDER.indexOf(artifact.kind)
      return rank(a) - rank(b) || a.name.localeCompare(b.name)
    })
  return files.slice(0, limit)
}
