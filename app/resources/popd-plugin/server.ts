import { Plugin } from "@opencode/plugin"
import { spawn } from "node:child_process"
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { tmpdir } from "node:os"

// The engine passes POPD_PLUGIN_LOG; never write into the install directory.
const logPath = process.env.POPD_PLUGIN_LOG ?? join(tmpdir(), "popd-plugin.log")

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
          return { content: result.ok ? `Opened ${target}` : `Could not open ${target}: ${result.error}` }
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
        name: "deliver_artifact",
        description:
          "Mark the main finished file the person should open. Call this once, with the primary result (the web page, document, image, video…).",
        input: {
          type: "object",
          properties: {
            path: { type: "string", description: "Absolute path to the main deliverable." },
            kind: { type: "string", description: "Optional short kind: web, pdf, image, sheet, slides, doc, video." },
          },
          required: ["path"],
          additionalProperties: false,
        },
        execute: async (input: { path: string; kind?: string }) => {
          log(`deliver_artifact ${input.path}`)
          try {
            writeFileSync(
              join(ctx.location.directory, ".popd-deliverable.json"),
              JSON.stringify({ path: input.path, kind: input.kind ?? null, at: new Date().toISOString() }, null, 2),
            )
          } catch {
            // the shell still falls back to its own detection
          }
          return { content: `Marked as the main result: ${input.path}` }
        },
      })

      editor.add({
        name: "needs_api_key",
        description:
          "Use when the job needs a key from an online service. PopPD will show the person a simple dialog with your instructions. Never ask the person to set environment variables or edit files.",
        input: {
          type: "object",
          properties: {
            service: { type: "string", description: "Human service name, e.g. 'OpenWeatherMap'." },
            url: { type: "string", description: "Where the person gets the key." },
            why: { type: "string", description: "One plain sentence on why it is needed." },
          },
          required: ["service"],
          additionalProperties: false,
        },
        execute: async (input: { service: string; url?: string; why?: string }) => {
          log(`needs_api_key ${JSON.stringify(input)}`)
          try {
            writeFileSync(
              join(ctx.location.directory, ".popd-api-key-request.json"),
              JSON.stringify({ ...input, at: new Date().toISOString() }, null, 2),
            )
          } catch {
            // the tool result still carries the request
          }
          return { content: `A key request for ${input.service} has been shown to the person.` }
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
