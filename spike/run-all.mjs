#!/usr/bin/env node
// Runs the spike matrix in order (E1..E9), one driver process per stage, then
// writes evidence/results.json and a data-filled EVIDENCE.md.
import { spawnSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { startPrivateServer } from "./driver.mjs"

const ROOT = path.dirname(fileURLToPath(import.meta.url))
const EVIDENCE = path.join(ROOT, "evidence")
const MODEL = "opencode-go/deepseek-v4.1-flash"
const INPUT_PRICE = 0.15 / 1_000_000
const OUTPUT_PRICE = 0.6 / 1_000_000

// PopPD bundles its own engine; the spike does the same so results do not depend
// on whatever shared service happens to be running on the machine.
const server = await startPrivateServer(Number(process.env.POPD_PORT ?? 0))
const serverArgs = ["--server-url", server.url, "--server-password", server.password]
process.on("exit", () => server.close())

fs.mkdirSync(EVIDENCE, { recursive: true })

// Prevent a harness restart from launching a second matrix.
const LOCK = path.join(ROOT, "runs", ".run-all.lock")
fs.mkdirSync(path.join(ROOT, "runs"), { recursive: true })
if (fs.existsSync(LOCK)) {
  const pid = Number(fs.readFileSync(LOCK, "utf8").trim())
  let alive = false
  try {
    process.kill(pid, 0)
    alive = true
  } catch {}
  if (alive && pid !== process.pid) {
    console.error(`run-all already running (pid ${pid}); refusing to start another`)
    process.exit(2)
  }
}
fs.writeFileSync(LOCK, String(process.pid))
const release = () => {
  try {
    if (fs.readFileSync(LOCK, "utf8").trim() === String(process.pid)) fs.unlinkSync(LOCK)
  } catch {}
}
process.on("exit", release)
process.on("SIGINT", () => {
  release()
  process.exit(130)
})

function stage(name, args, timeoutMs = 50 * 60_000) {
  console.log(`\n=== ${name} ===`)
  const started = Date.now()
  const result = spawnSync(process.execPath, [path.join(ROOT, "driver.mjs"), ...args], {
    cwd: ROOT,
    encoding: "utf8",
    timeout: timeoutMs,
    maxBuffer: 128 * 1024 * 1024,
  })
  const out = (result.stdout ?? "").trim()
  const err = (result.stderr ?? "").trim()
  if (err) console.log(err.slice(0, 3000))
  const lines = out.split(/\r?\n/).filter(Boolean)
  const jsonLine = [...lines].reverse().find((line) => line.trim().startsWith("{"))
  let parsed = null
  if (jsonLine) {
    try {
      parsed = JSON.parse(jsonLine)
    } catch {
      parsed = null
    }
  }
  console.log(jsonLine ?? out.slice(-4000))
  const record = { name, exitCode: result.status, wallMs: Date.now() - started, parsed, stderr: err.slice(0, 2000) }
  if (parsed?.workspace) {
    const summaryPath = path.join(parsed.workspace, "summary.json")
    if (fs.existsSync(summaryPath)) record.summary = JSON.parse(fs.readFileSync(summaryPath, "utf8"))
  }
  return record
}

function estimateCost(tokens) {
  if (!tokens) return null
  return Number(
    ((tokens.input ?? 0) * INPUT_PRICE + (tokens.output ?? 0) * OUTPUT_PRICE).toFixed(4),
  )
}

const results = { startedAt: new Date().toISOString(), model: MODEL, stages: [] }

results.stages.push(stage("config-check", [...serverArgs, "--config-check"], 2 * 60_000))
results.stages.push(stage("pomodoro-1", [...serverArgs, "--case", "pomodoro", "--timeout", "30"]))

results.stages.push(stage("chores", [...serverArgs, "--case", "chores", "--timeout", "30"]))
results.stages.push(stage("bad-model", [...serverArgs, "--case", "smoke", "--model", "opencode-go/popd-bad-model", "--timeout", "3"], 6 * 60_000))

const firstPomodoro = results.stages.find((s) => s.name === "pomodoro-1")?.parsed
if (firstPomodoro?.sessionID) {
  results.stages.push(stage("persistence-echo", [...serverArgs, "--echo-session", firstPomodoro.sessionID], 2 * 60_000))
}

for (const s of results.stages) {
  if (s.summary) s.summary.estimatedCostUsd = estimateCost(s.summary.tokens)
}

fs.writeFileSync(path.join(EVIDENCE, "results.json"), JSON.stringify(results, null, 2))

// ---------------------------------------------------------------- evidence.md
const config = results.stages.find((s) => s.name === "config-check")?.parsed
const runs = results.stages.filter((s) => s.name.startsWith("pomodoro") || s.name === "chores").map((s) => s.summary).filter(Boolean)
const echo = results.stages.find((s) => s.name === "persistence-echo")?.parsed
const bad = results.stages.find((s) => s.name === "bad-model")?.parsed

const fmt = (value) => (value === null || value === undefined ? "—" : String(value))
const money = (value) => (value === null || value === undefined ? "—" : `$${value.toFixed(4)}`)
const secs = (ms) => (ms === null || ms === undefined ? "—" : `${(ms / 1000).toFixed(1)}s`)

const runRows = runs
  .map((r) => {
    const html = (r.files ?? []).filter((f) => /\.html?$/i.test(f.path)).map((f) => f.path)
    const lint = r.lint?.ok ? "clean" : `FLAGGED (${r.lint.hard.map((h) => h.match).join(", ")})`
    return [
      r.case,
      r.sessionID,
      r.status,
      secs(r.durationMs),
      fmt(r.permissionAsks?.length),
      fmt(r.forms?.length),
      r.launcher ? "yes" : "NO",
      r.openToolCalled ? "yes" : "NO",
      lint,
      html.length ? html.join(", ") : "none",
      `${fmt(r.tokens?.input)} / ${fmt(r.tokens?.output)}`,
      money(r.estimatedCostUsd),
      r.workspace,
    ].map((cell) => String(cell).replaceAll("|", "\\|"))
  })
  .join("\n")

const hypothesis = {
  H1: runs.length > 0 && runs.every((r) => r.permissionAsks?.length === 0) && runs.every((r) => r.status === "succeeded" || r.status === "idle"),
  H2: runs.some((r) => (r.files ?? []).some((f) => /\.html?$/i.test(f.path))),
  H3: runs.some((r) => r.launcher && r.openToolCalled),
  H4: runs.length > 0 && runs.every((r) => r.lint?.ok),
  H5:
    Boolean(config) &&
    config.agents?.some((a) => a.id === "pop" && !a.hidden) &&
    !config.agents?.some((a) => a.id === "plan") &&
    Boolean(config.agents?.find((a) => a.id === "build")?.hidden) &&
    config.plugins?.some((p) => p.id === "popd") &&
    config.defaultModel?.providerID === "opencode-go" &&
    config.defaultModel?.id === "deepseek-v4.1-flash",
  H6: Boolean(config) && runs.length > 0,
  H7: Boolean(echo?.messages > 0),
}

const check = (ok) => (ok ? "PASS" : "FAIL")

const md = `# PopPD spike — evidence (generated ${results.startedAt})

Model: \`${MODEL}\` · Engine: ${fmt(config?.engine?.version)} · Windows first

## Data

| run | session | status | wall | asks | forms | launcher | open tool | lint | html | tokens in/out | est. cost | workspace |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
${runRows}

Config authority: primaries = ${(config?.agents ?? []).filter((a) => a.mode === "primary" && !a.hidden).map((a) => a.id).join(", ") || "—"}; plan present = ${config?.agents?.some((a) => a.id === "plan") ? "YES" : "no"}; build hidden = ${config?.agents?.find((a) => a.id === "build")?.hidden ? "yes" : "no"}; popd plugin = ${config?.plugins?.some((p) => p.id === "popd") ? "loaded" : "NOT LOADED"}; default model = ${config?.defaultModel ? config.defaultModel.providerID + "/" + config.defaultModel.id : "—"}.

Persistence across a fresh process (E8): ${echo ? `${fmt(echo.messages)} messages readable, outcome ${fmt(echo.outcome)}` : "not measured"}.

Bad-model failure (E7): status ${fmt(bad?.status)}, message ${fmt((bad?.finalText ?? "").slice(0, 200))}.

## Hypothesis checklist

| # | Hypothesis | Verdict |
| --- | --- | --- |
| H1 | Engine runs the task headless with zero approval prompts | ${check(hypothesis.H1)} |
| H2 | \`${MODEL}\` completes a real artifact | ${check(hypothesis.H2)} |
| H3 | Last mile: launcher + the agent opens the result itself | ${check(hypothesis.H3)} |
| H4 | No developer-speak in final messages | ${check(hypothesis.H4)} |
| H5 | One config file controls model, agent, permissions, plugin | ${check(hypothesis.H5)} |
| H6 | Key/auth and model access work from the engine | ${check(hypothesis.H6)} |
| H7 | Sessions persist and are readable by a new process | ${check(hypothesis.H7)} |
`

fs.writeFileSync(path.join(EVIDENCE, "EVIDENCE.md"), md)
console.log(`\nWrote ${path.join(EVIDENCE, "EVIDENCE.md")}`)
