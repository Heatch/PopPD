import { spawn, type ChildProcess } from "node:child_process"
import { EventEmitter } from "node:events"
import fs from "node:fs"
import path from "node:path"
import type { EngineStatus } from "../../shared/types"

export interface SupervisorOptions {
  binary: string
  config: object
  logDir: string
}

/**
 * Owns PopPD's OpenCode engine process.
 *
 * Spike findings baked in: keep draining stdout/stderr (an unread pipe freezes the
 * engine), health-check it, and restart on crash.
 */
export class EngineSupervisor extends EventEmitter {
  private child: ChildProcess | null = null
  private client: any = null
  private statusValue: EngineStatus = "stopped"
  private lines: string[] = []
  private buffer = ""
  private healthTimer: NodeJS.Timeout | null = null
  private healthFailures = 0
  private starting: Promise<void> | null = null
  private startingUp = false
  private restarts: number[] = []
  private restarting = false
  private stopping = false
  private logFile: string

  constructor(private options: SupervisorOptions) {
    super()
    fs.mkdirSync(options.logDir, { recursive: true })
    this.logFile = path.join(options.logDir, "engine.log")
    this.rotateLog()
  }

  get status(): EngineStatus {
    return this.statusValue
  }

  updateConfig(config: object) {
    this.options.config = config
  }

  get logs(): string {
    return this.lines.join("\n")
  }

  clientOrThrow(): any {
    if (!this.client) throw new Error("engine is not ready")
    return this.client
  }

  private setStatus(status: EngineStatus, detail?: string) {
    this.statusValue = status
    this.emit("status", status, detail)
  }

  private rotateLog() {
    try {
      if (fs.statSync(this.logFile).size > 5 * 1024 * 1024) {
        fs.renameSync(this.logFile, this.logFile + ".1")
      }
    } catch {
      // no log yet
    }
  }

  async start(): Promise<void> {
    if (this.statusValue === "ready" && this.client) return
    if (this.starting) return this.starting
    this.stopping = false
    this.starting = this.spawnAndWait().finally(() => {
      this.starting = null
    })
    return this.starting
  }

  private spawnAndWait(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.setStatus("starting")
      this.buffer = ""

      let child: ChildProcess
      try {
        child = spawn(this.options.binary, ["serve", "--hostname", "127.0.0.1", "--port", "0"], {
          env: {
            ...process.env,
            OPENCODE_CONFIG_CONTENT: JSON.stringify(this.options.config),
            POPD_PLUGIN_LOG: path.join(this.options.logDir, "plugin.log"),
          },
          windowsHide: true,
          stdio: ["ignore", "pipe", "pipe"],
        })
      } catch (error) {
        this.setStatus("error", String(error))
        reject(error)
        return
      }

      this.child = child
      this.startingUp = true

      let url: string | null = null
      let password: string | null = null
      let settled = false

      const finish = async (ok: boolean, detail?: string) => {
        if (settled) return
        settled = true
        this.startingUp = false
        clearTimeout(timeout)
        if (ok) {
          try {
            const { OpenCode } = await import("@opencode/client")
            const headers = {
              authorization: "Basic " + Buffer.from(`opencode:${password}`).toString("base64"),
            }
            this.client = OpenCode.make({ baseUrl: url!, headers })
            this.setStatus("ready")
            this.startHealth()
            resolve()
          } catch (error) {
            this.client = null
            this.setStatus("error", `Could not connect to the engine: ${String(error)}`)
            reject(error)
          }
        } else {
          this.client = null
          this.setStatus("error", detail)
          reject(new Error(detail ?? "engine did not start"))
        }
      }

      const timeout = setTimeout(() => {
        try {
          child.kill()
        } catch {}
        finish(false, "The engine did not start in time.")
      }, 30_000)

      const onData = (chunk: Buffer) => {
        const text = chunk.toString()
        this.buffer += text
        const parts = this.buffer.split(/\r?\n/)
        this.buffer = parts.pop() ?? ""
        for (const line of parts) this.handleLine(line, (u, p) => {
          if (u) url = u
          if (p) password = p
          if (url && password) finish(true)
        })
      }

      child.stdout?.on("data", onData)
      child.stderr?.on("data", onData)

      child.once("error", (error) => {
        this.handleLine(`spawn error: ${String(error)}`, () => {})
        finish(false, `Could not start the engine: ${String(error)}`)
      })

      child.once("exit", (code) => {
        this.handleLine(`engine exited (${code})`, () => {})
        this.client = null
        this.stopHealth()
        if (!this.stopping && !this.startingUp) {
          this.setStatus("error", "The engine stopped unexpectedly.")
          void this.maybeRestart()
        }
      })
    })
  }

  private handleLine(line: string, onStartupLine: (url?: string, password?: string) => void) {
    if (!line.trim()) return
    this.lines.push(line)
    if (this.lines.length > 500) this.lines.shift()
    fs.appendFile(this.logFile, line + "\n", () => {})
    const url = line.match(/listening on\s+(https?:\/\/\S+)/)?.[1]
    const password = line.match(/server password\s+(\S+)/)?.[1]
    onStartupLine(url, password)
  }

  private startHealth() {
    this.stopHealth()
    this.healthFailures = 0
    this.healthTimer = setInterval(async () => {
      if (this.stopping || !this.client) return
      try {
        await Promise.race([
          this.client.server.info(),
          new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 5000)),
        ])
        this.healthFailures = 0
      } catch {
        this.healthFailures++
        if (this.healthFailures >= 2) {
          this.setStatus("error", "The engine stopped responding.")
          void this.maybeRestart()
        }
      }
    }, 10_000)
  }

  private stopHealth() {
    if (this.healthTimer) clearInterval(this.healthTimer)
    this.healthTimer = null
  }

  private async maybeRestart(): Promise<void> {
    if (this.stopping || this.restarting) return
    const now = Date.now()
    this.restarts = this.restarts.filter((t) => now - t < 5 * 60_000)
    if (this.restarts.length >= 3) {
      this.setStatus("error", "The engine keeps stopping. Restart PopPD.")
      return
    }
    this.restarts.push(now)
    this.restarting = true
    try {
      await this.stop()
      await new Promise((r) => setTimeout(r, 1500))
      await this.start()
    } catch {
      this.setStatus("error", "The engine could not restart.")
    } finally {
      this.restarting = false
    }
  }

  async restart(): Promise<void> {
    this.restarts = []
    await this.stop()
    await new Promise((r) => setTimeout(r, 500))
    await this.start()
  }

  async stop(): Promise<void> {
    this.stopping = true
    this.stopHealth()
    const child = this.child
    this.child = null
    this.client = null
    if (child) {
      try {
        child.kill()
      } catch {}
    }
    this.setStatus("stopped")
  }
}
