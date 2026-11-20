// The spike's developer-speak detector, promoted to a product guardrail.
// Hard findings are stripped from anything the user sees; soft findings are
// kept only for tuning logs.

const HARD: RegExp[] = [
  /\bnpm\b/i,
  /\bnpx\b/i,
  /\byarn\b/i,
  /\bpnpm\b/i,
  /\bbun\s+(install|run|add|x)\b/i,
  /\bpip\s+install\b/i,
  /\bterminal\b/i,
  /\bcommand\s+(prompt|line)\b/i,
  /\bpowershell\b/i,
  /\bcmd\.exe\b/i,
  /\bbash\b/i,
  /\brun\s+(the\s+)?(following|this|that)\s+(command|script)\b/i,
  /\bcd\s+[A-Za-z]:?\\/i,
  /\bnpm\s+run\s+dev\b/i,
  /\bnode\s+[^\s]+\.js\b/i,
  /\binstall\s+(the\s+)?(dependencies|packages|node|python)\b/i,
  /\bpackage\.json\b/i,
  /\bvirtual\s+environment\b/i,
]

const SOFT = [
  /\blocalhost\b/i,
  /\bport\s+\d{2,5}\b/i,
  /\bhttp:\/\//i,
  /\bgit\b/i,
  /\brepository\b/i,
  /\bapi\s+key\b/i,
  /\bserver\b/i,
  /\bpython\b/i,
  /\bnode\.?js\b/i,
  /\bjavascript\b/i,
  /\bhtml\b/i,
  /\bfile\s+path\b/i,
  /\bshell\b/i,
]

export interface LintResult {
  ok: boolean
  hard: string[]
  soft: string[]
}

export function lint(text: string): LintResult {
  const hard = HARD.filter((pattern) => pattern.test(text)).map((pattern) => String(pattern))
  const soft = SOFT.filter((pattern) => pattern.test(text)).map((pattern) => String(pattern))
  return { ok: hard.length === 0, hard, soft }
}

/**
 * Removes developer-speak from a message before it reaches a person:
 * code fences, backticks, and any line/bullet that contains a hard finding.
 * Falls back to a plain completion sentence if nothing readable is left.
 */
export function sanitize(text: string): { text: string; changed: boolean; removed: number } {
  const original = text ?? ""
  let working = original
    .replace(/```[\s\S]*?```/g, "")
    .replace(/`([^`]+)`/g, "$1")
    // PopPD shows plain text, so markdown emphasis would arrive as stray asterisks.
    .replace(/\*\*([^*\n]+)\*\*/g, "$1")
    .replace(/(^|[\s(])\*([^*\n]+)\*(?=$|[\s).,!?])/g, "$1$2")

  const lines = working.split(/\r?\n/)
  const kept: string[] = []
  let removed = 0
  for (const line of lines) {
    if (!line.trim()) {
      kept.push("")
      continue
    }
    if (HARD.some((pattern) => pattern.test(line))) {
      removed++
      continue
    }
    kept.push(line)
  }

  working = kept.join("\n").replace(/\n{3,}/g, "\n\n").trim()
  if (!working) {
    working = "Done — your result is ready."
  }
  return { text: working, changed: working !== original.trim(), removed }
}
