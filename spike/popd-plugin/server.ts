import { Plugin } from "@opencode/plugin"
import { spawn } from "node:child_process"
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const logPath = join(here, "..", "runs", "_plugin.log")

function log(line: string) {
  try {
    mkdirSync(dirname(logPath), { recursive: true })
    appendFileSync(logPath, `${new Date().toISOString()} ${line}\n`)
  } catch {
    // logging must never break the agent loop
  }
}

function run(command: string, args: string[]) {
  return new Promise<{ ok: boolean; error?: string }>((resolve) => {
    try {
      const child = spawn(command, args, { detached: true, stdio: "ignore", windowsHide: true })
      child.once("error", (error) => resolve({ ok: false, error: String(error) }))
      child.once("spawn", () => {
        child.unref()
        resolve({ ok: true })
      })
    } catch (error) {
      resolve({ ok: false, error: String(error) })
    }
  })
}

export default Plugin.define({
  id: "popd",
  async setup(ctx) {
    await ctx.tool.transform((editor) => {
      editor.add({
        name: "open_with_default_app",
        description:
          "Open a finished file or folder on the user's computer with its default application. Call this as the final step of a delivery so the result appears on screen by itself.",
        input: {
          type: "object",
          properties: {
            path: { type: "string", description: "Absolute path to the file or folder to open." },
          },
          required: ["path"],
          additionalProperties: false,
        },
        execute: async (input: { path: string }) => {
          const target = String(input.path)
          log(`open_with_default_app ${target}`)
          const result =
            process.platform === "win32"
              ? await run("cmd.exe", ["/c", "start", "", target])
              : process.platform === "darwin"
                ? await run("open", [target])
                : await run("xdg-open", [target])
          return {
            content: result.ok ? `Opened ${target}` : `Could not open ${target}: ${result.error}`,
          }
        },
      })

      editor.add({
        name: "show_in_folder",
        description:
          "Show a finished file in the user's file browser with the file selected. Use when the user needs to move or share the artifact.",
        input: {
          type: "object",
          properties: {
            path: { type: "string", description: "Absolute path to the file to reveal." },
          },
          required: ["path"],
          additionalProperties: false,
        },
        execute: async (input: { path: string }) => {
          const target = String(input.path)
          log(`show_in_folder ${target}`)
          const result =
            process.platform === "win32"
              ? await run("explorer.exe", [`/select,${target}`])
              : process.platform === "darwin"
                ? await run("open", ["-R", target])
                : await run("xdg-open", [dirname(target)])
          return { content: result.ok ? `Revealed ${target}` : `Could not reveal ${target}: ${result.error}` }
        },
      })

      editor.add({
        name: "escalate",
        description:
          "Hand this request to a human developer. Use ONLY for paid API keys, serving many users, or unusually high compute or storage. Explain in plain language why a developer is needed.",
        input: {
          type: "object",
          properties: {
            reason: { type: "string", description: "Short category: api-key, scale, compute, or storage." },
            explanation: { type: "string", description: "Two plain-language sentences for a nontechnical person." },
          },
          required: ["reason", "explanation"],
          additionalProperties: false,
        },
        execute: async (input: { reason: string; explanation: string }) => {
          log(`escalate ${JSON.stringify(input)}`)
          try {
            writeFileSync(
              join(ctx.location.directory, "popd-escalation.json"),
              JSON.stringify({ ...input, at: new Date().toISOString() }, null, 2),
            )
          } catch {
            // the tool result still carries the handoff
          }
          return { content: `Developer handoff recorded: ${input.explanation}` }
        },
      })
    })
  },
})
