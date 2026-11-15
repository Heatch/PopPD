import fs from "node:fs"
import type { Backend } from "../backend/types"

export function rulesFileLooksValid(rulesPath: string): { ok: boolean; reason?: string } {
  try {
    const text = fs.readFileSync(rulesPath, "utf8")
    if (text.length < 200) return { ok: false, reason: "The rules file looks too small." }
    if (!/PopPD/.test(text)) return { ok: false, reason: "The rules file does not mention PopPD." }
    return { ok: true }
  } catch {
    return { ok: false, reason: "The rules file is missing." }
  }
}

/** Cheap persona check: costs one tiny model call. */
export async function probePersona(
  backend: Backend,
  workspace: string,
  model: string,
  timeoutMs = 90_000,
): Promise<{ ok: boolean; text: string }> {
  const sessionID = await backend.createSession({ title: "PopPD setup check", directory: workspace, model })
  await backend.prompt(sessionID, "Who are you, and what do you do? Answer in one short sentence.")
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    const state = await backend.session(sessionID)
    if (state.outcome) break
    await new Promise((r) => setTimeout(r, 1500))
  }
  const messages = await backend.messages(sessionID)
  const text = [...messages].reverse().find((m) => m.type === "assistant" && m.text)?.text ?? ""
  return { ok: /popd/i.test(text) && !/opencode/i.test(text), text }
}
