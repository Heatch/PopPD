import { app } from "electron"
import { autoUpdater } from "electron-updater"
import type { UpdateState } from "../shared/types"

const isMock = () => process.env.POPD_MOCK === "1"

export class Updates {
  private state: UpdateState = { status: "idle" }

  constructor(private emit: (state: UpdateState) => void) {
    try {
      autoUpdater.autoDownload = false
      autoUpdater.autoInstallOnAppQuit = true
      autoUpdater.on("update-available", (info: any) =>
        this.set({ status: "available", version: String(info?.version ?? "") }),
      )
      autoUpdater.on("update-not-available", () => this.set({ status: "none" }))
      autoUpdater.on("download-progress", (progress: any) =>
        this.set({ status: "downloading", percent: Math.round(Number(progress?.percent ?? 0)) }),
      )
      autoUpdater.on("update-downloaded", () => this.set({ status: "ready", version: this.state.version }))
      autoUpdater.on("error", (error: any) =>
        this.set({ status: "error", message: String(error?.message ?? error) }),
      )
    } catch {
      // updater is only meaningful in a packaged app
    }
  }

  get(): UpdateState {
    return this.state
  }

  private set(state: UpdateState) {
    this.state = state
    this.emit(state)
  }

  async check(): Promise<UpdateState> {
    if (isMock()) {
      this.set({ status: "available", version: "9.9.9" })
      return this.state
    }
    if (!app.isPackaged) {
      this.set({ status: "none", message: "Update checks run in the installed app." })
      return this.state
    }
    this.set({ status: "checking" })
    try {
      await autoUpdater.checkForUpdates()
    } catch (error) {
      this.set({ status: "error", message: String((error as Error)?.message ?? error) })
    }
    return this.state
  }

  async download(): Promise<UpdateState> {
    if (isMock()) {
      this.set({ status: "downloading", percent: 0 })
      await new Promise((resolve) => setTimeout(resolve, 500))
      this.set({ status: "ready", version: "9.9.9" })
      return this.state
    }
    if (!app.isPackaged) return this.check()
    try {
      await autoUpdater.downloadUpdate()
    } catch (error) {
      this.set({ status: "error", message: String((error as Error)?.message ?? error) })
    }
    return this.state
  }

  install(): void {
    if (isMock() || !app.isPackaged) return
    autoUpdater.quitAndInstall()
  }
}
