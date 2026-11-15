import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { BrowserWindow, nativeImage } from "electron"

export interface Thumbnailer {
  ensure(file: string): Promise<string | null>
}

const IMAGE = /\.(png|jpe?g|webp|gif|bmp)$/i
const HTML = /\.html?$/i

/**
 * Renders previews without native image dependencies: images through nativeImage,
 * web pages through a hidden BrowserWindow screenshot.
 */
export class ElectronThumbnailer implements Thumbnailer {
  constructor(private cacheDir: string) {
    fs.mkdirSync(cacheDir, { recursive: true })
    this.prune()
  }

  private prune() {
    try {
      const files = fs
        .readdirSync(this.cacheDir)
        .map((name) => ({ name, at: fs.statSync(path.join(this.cacheDir, name)).mtimeMs }))
        .sort((a, b) => b.at - a.at)
      for (const entry of files.slice(300)) {
        try {
          fs.unlinkSync(path.join(this.cacheDir, entry.name))
        } catch {
          // another process may have removed it
        }
      }
    } catch {
      // a missing cache dir is fine
    }
  }

  async ensure(file: string): Promise<string | null> {
    let stat: fs.Stats
    try {
      stat = fs.statSync(file)
    } catch {
      return null
    }
    const hash = crypto
      .createHash("sha1")
      .update(`${file}:${stat.mtimeMs}:${stat.size}`)
      .digest("hex")
    const out = path.join(this.cacheDir, `${hash}.png`)
    if (fs.existsSync(out)) return out

    try {
      if (IMAGE.test(file)) {
        const image = nativeImage.createFromPath(file)
        if (image.isEmpty()) return null
        const resized = image.resize({ width: 640 })
        fs.writeFileSync(out, resized.toPNG())
        return out
      }
      if (HTML.test(file)) {
        return await this.captureHtml(file, out)
      }
    } catch {
      return null
    }
    return null
  }

  private async captureHtml(file: string, out: string): Promise<string | null> {
    const window = new BrowserWindow({
      show: false,
      width: 960,
      height: 720,
      webPreferences: { offscreen: true, sandbox: true },
    })
    try {
      await window.loadFile(file)
      await new Promise((resolve) => setTimeout(resolve, 1200))
      const image = await window.webContents.capturePage()
      if (image.isEmpty()) return null
      fs.writeFileSync(out, image.resize({ width: 640 }).toPNG())
      return out
    } catch {
      return null
    } finally {
      window.destroy()
    }
  }
}
