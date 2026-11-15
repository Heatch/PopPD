import fs from "node:fs"
import path from "node:path"
import type { ChatSummary, LibraryEntry } from "../../shared/types"
import { artifactKind, listArtifacts } from "../delivery/artifacts"
import { mainArtifactPath } from "../delivery/launcher"
import type { Thumbnailer } from "./thumbnailer"

export class Library {
  private entries = new Map<string, LibraryEntry>()

  constructor(
    private options: {
      indexPath: string
      thumbnailer: Thumbnailer
    },
  ) {
    this.load()
  }

  private load() {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.options.indexPath, "utf8"))
      if (Array.isArray(parsed)) {
        for (const entry of parsed) this.entries.set(entry.chatId, entry)
      }
    } catch {
      this.entries = new Map()
    }
  }

  private save() {
    try {
      fs.mkdirSync(path.dirname(this.options.indexPath), { recursive: true })
      fs.writeFileSync(this.options.indexPath, JSON.stringify(this.list(), null, 2))
    } catch {
      // the library is a convenience; never fail a run because of it
    }
  }

  list(): LibraryEntry[] {
    return [...this.entries.values()].sort((a, b) => b.updatedAt - a.updatedAt)
  }

  get(chatId: string): LibraryEntry | undefined {
    return this.entries.get(chatId)
  }

  async refresh(chats: ChatSummary[]): Promise<LibraryEntry[]> {
    const next = new Map<string, LibraryEntry>()
    for (const chat of chats) {
      const artifacts = listArtifacts(chat.workspace)
      const mainPath = mainArtifactPath(chat.workspace)
      const main =
        artifacts.find((artifact) => artifact.path === mainPath) ??
        (mainPath && fs.existsSync(mainPath)
          ? {
              path: mainPath,
              name: path.basename(mainPath),
              kind: artifactKind(mainPath),
              bytes: fs.statSync(mainPath).size,
            }
          : null)

      let thumb = this.entries.get(chat.id)?.thumb ?? null
      if (main && (main.kind === "web" || main.kind === "image")) {
        const made = await this.options.thumbnailer.ensure(main.path).catch(() => null)
        if (made) thumb = made
      }

      next.set(chat.id, {
        chatId: chat.id,
        chatTitle: chat.title,
        workspace: chat.workspace,
        main,
        artifacts,
        thumb,
        updatedAt: chat.updatedAt,
      })
    }
    this.entries = next
    this.save()
    return this.list()
  }
}
