#!/usr/bin/env node
// PopPD spike driver: runs one case through a live OpenCode engine and records
// everything the memo needs. This is the production-shaped path: spawn/discover
// the engine, create a session bound to a workspace, prompt it, stream events,
// then audit the result.
import fs from "node:fs"
import path from "node:path"
import { spawn } from "node:child_process"
import { fileURLToPath, pathToFileURL } from "node:url"
import { OpenCode } from "@opencode/client"
import { Service } from "@opencode/client/service"
import { lint } from "./lint.mjs"

const ROOT = path.dirname(fileURLToPath(import.meta.url))
const RUNS = path.join(ROOT, "runs")

function parseArgs(argv) {
  const out = {
    case: "pomodoro",
    model: "opencode-go/deepseek-v4.1-flash",
    agent: "pop",
    timeoutMin: 25,
    config: false,
    echoSession: null,
  }
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i]
    if (key === "--case") out.case = argv[++i]
    else if (key === "--model") out.model = argv[++i]
    else if (key === "--agent") out.agent = argv[++i]
    else if (key === "--timeout") out.timeoutMin = Number(argv[++i])
    else if (key === "--config-check") out.config = true
    else if (key === "--echo-session") out.echoSession = argv[++i]
    else if (key === "--server-url") out.serverUrl = argv[++i]
    else if (key === "--server-password") out.serverPassword = argv[++i]
    else if (key === "--private") out.private = true
    else if (key === "--deliver") out.deliver = argv[++i]
  }
  return out
}

function parseModel(ref) {
  const slash = ref.indexOf("/")
  const providerID = ref.slice(0, slash)
  const [id, variant] = ref.slice(slash + 1).split("#")
  return variant ? { providerID, id, variant } : { providerID, id }
}

function stamp() {
  return new Date().toISOString().replace(/[:.]/g, "-")
}

function mainHtmlFile(files) {
  return [...files]
    .filter((file) => /\.html?$/i.test(file.path))
    .sort((a, b) => {
      const score = (p) => (/(^|\/)index\.html?$/i.test(p) ? 3 : /app|main|pomodoro|chores/i.test(p) ? 2 : 1)
      return score(b.path) - score(a.path)
    })[0]
}

export function ensureLauncher(workspace) {
  const before = walk(workspace).map((file) => ({
    path: path.relative(workspace, file).replaceAll("\\", "/"),
    bytes: fs.statSync(file).size,
  }))
  const existing = before.find((file) => /^open this\.(bat|cmd|command)$/i.test(file.path))
  if (existing) return { path: existing.path, auto: false }
  const main = mainHtmlFile(before)
  if (!main) return null
  const target = main.path.split("/").at(-1)
  fs.writeFileSync(path.join(workspace, "Open this.bat"), `@echo off\r\nstart "" "%~dp0${target}"\r\n`)
  return { path: "Open this.bat", auto: true }
}

function walk(dir) {
  const files = []
  const stack = [dir]
  while (stack.length) {
    const current = stack.pop()
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name)
      if (entry.isDirectory()) stack.push(full)
      else files.push(full)
    }
  }
  return files.sort()
}

function textOf(message) {
  if (!message || message.type !== "assistant") return ""
  return (message.content ?? [])
    .filter((part) => part.type === "text" && typeof part.text === "string")
    .map((part) => part.text)
    .join("\n")
}

function toolNames(messages) {
  const names = []
  for (const message of messages) {
    if (message.type !== "assistant") continue
    for (const part of message.content ?? []) {
      if (part.type !== "tool" || !part.name) continue
      names.push(part.name)
      // Code Mode nests plugin tools inside the `execute` tool; surface them for
      // the audit so "did it use the open tool" is answerable.
      if (part.name === "execute") {
        const blob = JSON.stringify(part.state ?? {})
        for (const nested of ["open_with_default_app", "show_in_folder", "escalate"]) {
          if (blob.includes(nested)) names.push(nested)
        }
      }
    }
  }
  return names
}

function answerFor(form) {
  const answer = {}
  for (const field of form.fields ?? []) {
    if (field.type === "string") {
      answer[field.key] = field.options?.[0]?.value ?? field.default ?? "Use your best judgment."
    } else if (field.type === "multiselect") {
      answer[field.key] = field.default ?? (field.options?.[0] ? [field.options[0].value] : [])
    } else if (field.type === "boolean") {
      answer[field.key] = field.default ?? true
    } else if (field.type === "number" || field.type === "integer") {
      const fallback = field.default
      answer[field.key] = typeof fallback === "number" ? fallback : 1
    }
  }
  return answer
}

export async function connect(options = {}) {
  const url = options.url ?? process.env.POPD_SERVER_URL
  const password = options.password ?? process.env.POPD_SERVER_PASSWORD
  if (url) {
    const headers = password
      ? { authorization: "Basic " + Buffer.from(`opencode:${password}`).toString("base64") }
      : undefined
    const client = OpenCode.make({ baseUrl: url, headers })
    const info = await client.server.info()
    return { client, endpoint: { url, password }, info }
  }
  const endpoint = await Service.ensure()
  const client = OpenCode.make({ baseUrl: endpoint.url, headers: Service.headers(endpoint) })
  const info = await client.server.info()
  return { client, endpoint, info }
}

export function startPrivateServer(port = 0) {
  return new Promise((resolve, reject) => {
    const child = spawn("opencode", ["serve", "--hostname", "127.0.0.1", "--port", String(port)], {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    })
    let output = ""
    let url = null
    let password = null
    let settled = false
    const timer = setTimeout(() => {
      child.kill()
      reject(new Error(`private server did not start in time: ${output.slice(-500)}`))
    }, 30_000)
    const onData = (chunk) => {
      // Keep draining the pipe after startup: an unread pipe eventually blocks
      // the server on a log write and the engine appears to hang.
      const text = chunk.toString()
      if (settled) return
      output += text
      const urlMatch = output.match(/listening on\s+(https?:\/\/[^\s]+)/)
      const passMatch = output.match(/server password\s+(\S+)/)
      if (urlMatch) url = urlMatch[1]
      if (passMatch) password = passMatch[1]
      if (url && password) {
        settled = true
        clearTimeout(timer)
        resolve({
          url,
          password,
          close() {
            try {
              child.kill()
            } catch {}
          },
        })
      }
    }
    child.stdout.on("data", onData)
    child.stderr.on("data", onData)
    child.once("error", (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.once("exit", (code) => {
      clearTimeout(timer)
      if (!url) reject(new Error(`private server exited (${code}): ${output.slice(-500)}`))
    })
  })
}

export async function configCheck(client, opts) {
  const location = { directory: RUNS }
  // A location has to be initialized (a session created) before agent/plugin
  // resolution is available. Seed one, then remove it.
  const seed = await client.session
    .create({ title: "_config-check", location: { directory: RUNS } })
    .catch(() => null)
  if (seed) await new Promise((resolve) => setTimeout(resolve, 1500))
  const agents = await client.agent.list({ location })
  const plugins = await client.plugin.list({ location })
  const mcp = await client.mcp.list({ location })
  const model = await client.model.default({ location })
  let config
  try {
    config = await client.config.get()
  } catch (error) {
    config = { error: String(error) }
  }

  const report = {
    at: new Date().toISOString(),
    engine: await client.server.info().catch(() => null),
    agents: agents.data.map((agent) => ({
      id: agent.id,
      mode: agent.mode,
      hidden: agent.hidden,
      model: agent.model ?? null,
      description: agent.description ?? null,
      systemChars: agent.system?.length ?? 0,
      permissions: agent.permissions?.length ?? 0,
    })),
    plugins: plugins.data.map((plugin) => ({ id: plugin.id, source: plugin.source ?? null })),
    mcp: mcp.data.map((server) => ({ name: server.name, status: server.status ?? null, disabled: server.disabled ?? null })),
    defaultModel: model.data ? { providerID: model.data.providerID, id: model.data.id } : null,
    config,
  }

  fs.mkdirSync(RUNS, { recursive: true })
  fs.writeFileSync(path.join(RUNS, "_config-check.json"), JSON.stringify(report, null, 2))
  if (seed) await client.session.remove({ sessionID: seed.id }).catch(() => {})
  console.log(
    JSON.stringify({
      mode: "config-check",
      agents: report.agents.map((a) => `${a.id}:${a.mode}${a.hidden ? ":hidden" : ""}`),
      plugins: report.plugins,
      mcp: report.mcp,
      defaultModel: report.defaultModel,
    }),
  )
  return report
}

export async function waitForOutcome(client, sessionID, timeoutMs, opts = {}) {
  const stallMs = opts.stallMs ?? 4 * 60_000
  const started = Date.now()
  let lastUpdated = Date.now()
  const answeredForms = new Set()
  await new Promise((resolve) => setTimeout(resolve, 2000))

  const sweep = async () => {
    // Permissions should never appear with an allow-all policy, but never let a
    // stray prompt wedge the run.
    try {
      const pending = await client.permission.request.list({ sessionID })
      for (const request of pending?.data ?? []) {
        await client.permission.reply({ sessionID, requestID: request.id, decision: "once" }).catch(() => {})
      }
    } catch {}
    // The form stream is not reliable; poll for pending questions.
    try {
      const forms = await client.session.form.list({ sessionID })
      for (const form of forms ?? []) {
        if (answeredForms.has(form.id)) continue
        answeredForms.add(form.id)
        const detail = await client.session.form.get({ sessionID, formID: form.id }).catch(() => form)
        await client.session.form
          .reply({ sessionID, formID: form.id, answer: answerFor(detail) })
          .catch(() => {})
      }
    } catch {}
  }

  while (Date.now() - started < timeoutMs) {
    const info = await client.session.get({ sessionID }).catch(() => null)
    if (info?.outcome) return { status: info.outcome, ms: Date.now() - started }
    const updated = info?.time?.updated ?? 0
    if (updated > lastUpdated) lastUpdated = updated
    if (Date.now() - lastUpdated > stallMs) {
      await client.session.interrupt({ sessionID }).catch(() => {})
      return { status: "stalled", ms: Date.now() - started }
    }
    await sweep()
    await new Promise((resolve) => setTimeout(resolve, 2500))
  }
  await client.session.interrupt({ sessionID }).catch(() => {})
  return { status: "timeout", ms: Date.now() - started }
}

export async function runCase(client, opts) {
  const id = `${opts.case}-${stamp()}`
  const workspace = path.join(RUNS, id)
  fs.mkdirSync(workspace, { recursive: true })
  const promptPath = path.join(ROOT, "cases", `${opts.case}.md`)
  const prompt = fs.readFileSync(promptPath, "utf8").trim()

  const session = await client.session.create({
    title: id,
    agent: opts.agent,
    model: parseModel(opts.model),
    location: { directory: workspace },
  })

  const events = []
  const asks = []
  const forms = []
  const ac = new AbortController()
  let sawIdle = false

  const consumer = (async () => {
    try {
      for await (const event of client.event.subscribe({}, { signal: ac.signal })) {
        const sessionID = event?.data?.sessionID
        if (sessionID !== session.id) continue
        events.push(event)
        if (event.type === "session.idle") {
          sawIdle = true
        } else if (event.type === "permission.asked") {
          asks.push(event.data)
          client.permission
            .reply({ sessionID: session.id, requestID: event.data.id, decision: "once" })
            .catch(() => {})
        } else if (event.type === "form.created") {
          const form = event.data.form
          forms.push(form)
          client.session.form
            .reply({ sessionID: session.id, formID: form.id, answer: answerFor(form) })
            .catch(() => {})
        }
      }
    } catch {
      // subscription ended
    }
  })()

  const startedAt = Date.now()
  await client.session.prompt({ sessionID: session.id, text: prompt })

  const waited = await waitForOutcome(client, session.id, opts.timeoutMin * 60_000)
  if (waited.status === "timeout") {
    await client.session.interrupt({ sessionID: session.id }).catch(() => {})
  }
  const status = waited.status
  const durationMs = Date.now() - startedAt

  ac.abort()

  const info = await client.session.get({ sessionID: session.id }).catch(() => null)
  const listed = await client.message.list({ sessionID: session.id, order: "asc", limit: 200 }).catch(() => ({ data: [] }))
  const messages = listed.data ?? []
  const assistant = [...messages].reverse().find((message) => message.type === "assistant")
  const finalText = textOf(assistant)
  const tools = toolNames(messages)

  let files = walk(workspace).map((file) => ({
    path: path.relative(workspace, file).replaceAll("\\", "/"),
    bytes: fs.statSync(file).size,
  }))
  const agentLauncher = files.find((file) => /^open this\.(bat|cmd|command)$/i.test(file.path))
  let launcherPath = agentLauncher ? path.join(workspace, agentLauncher.path.replaceAll("/", "\\")) : null
  let launcherAuto = false

  // PopPD must guarantee the last mile even when the model forgets it: if the
  // workspace has an HTML artifact and no launcher, the shell writes one.
  if (!launcherPath) {
    const mainHtml = [...files]
      .filter((file) => /\.html?$/i.test(file.path))
      .sort((a, b) => {
        const score = (p) => (/(^|\/)index\.html?$/i.test(p) ? 3 : /app|main|pomodoro|chores/i.test(p) ? 2 : 1)
        return score(b.path) - score(a.path)
      })[0]
    if (mainHtml) {
      const target = mainHtml.path.split("/").at(-1)
      const bat = `@echo off\r\nstart "" "%~dp0${target}"\r\n`
      launcherPath = path.join(workspace, "Open this.bat")
      fs.writeFileSync(launcherPath, bat)
      launcherAuto = true
      files = walk(workspace).map((file) => ({
        path: path.relative(workspace, file).replaceAll("\\", "/"),
        bytes: fs.statSync(file).size,
      }))
    }
  }
  const launcher = files.find((file) => path.join(workspace, file.path.replaceAll("/", "\\")) === launcherPath)

  const summary = {
    case: opts.case,
    sessionID: session.id,
    workspace,
    model: opts.model,
    agent: opts.agent,
    status,
    sawIdle,
    durationMs,
    outcome: info?.outcome ?? null,
    costUsd: info?.cost ?? null,
    tokens: info?.tokens ?? null,
    permissionAsks: asks,
    forms: forms.map((form) => ({ id: form.id, title: form.title, fields: (form.fields ?? []).map((f) => f.key) })),
    toolCalls: tools,
    openToolCalled: tools.includes("open_with_default_app"),
    files,
    launcher: launcher
      ? { path: launcher.path, text: fs.readFileSync(launcherPath, "utf8") }
      : null,
    finalText,
    lint: lint(finalText),
  }

  fs.writeFileSync(path.join(workspace, "events.jsonl"), events.map((event) => JSON.stringify(event)).join("\n"))
  fs.writeFileSync(path.join(workspace, "summary.json"), JSON.stringify(summary, null, 2))
  fs.writeFileSync(path.join(workspace, "final-message.md"), finalText)

  console.log(
    JSON.stringify({
      mode: "run",
      case: summary.case,
      sessionID: summary.sessionID,
      status: summary.status,
      durationMs: summary.durationMs,
      costUsd: summary.costUsd,
      tokens: summary.tokens,
      permissionAsks: summary.permissionAsks.length,
      forms: summary.forms.length,
      openToolCalled: summary.openToolCalled,
      launcher: summary.launcher?.path ?? null,
      files: summary.files.length,
      lintOk: summary.lint.ok,
      lintHard: summary.lint.hard.map((hit) => hit.match),
      finalText: summary.finalText,
      workspace: summary.workspace,
    }),
  )

  return summary
}

export async function echoSession(client, sessionID) {
  const info = await client.session.get({ sessionID })
  const listed = await client.message.list({ sessionID, order: "asc", limit: 200 })
  const messages = listed.data ?? []
  const assistant = [...messages].reverse().find((message) => message.type === "assistant")
  console.log(
    JSON.stringify({
      mode: "echo",
      sessionID,
      outcome: info.outcome,
      costUsd: info.cost,
      messages: messages.length,
      finalText: textOf(assistant).slice(0, 400),
    }),
  )
}

async function main() {
  const opts = parseArgs(process.argv.slice(2))
  if (opts.deliver) {
    const result = ensureLauncher(opts.deliver)
    console.log(JSON.stringify({ mode: "deliver", workspace: opts.deliver, ...(result ?? {}) }))
    process.exit(0)
  }
  let server = null
  if (opts.private) {
    server = await startPrivateServer(0)
    opts.serverUrl = server.url
    opts.serverPassword = server.password
    process.on("exit", () => server.close())
  }
  const { client } = await connect({ url: opts.serverUrl, password: opts.serverPassword })
  if (opts.config) {
    await configCheck(client, opts)
  } else if (opts.echoSession) {
    await echoSession(client, opts.echoSession)
  } else {
    await runCase(client, opts)
  }
  process.exit(0)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error)
    process.exit(1)
  })
}
