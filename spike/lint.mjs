// Dev-speak lint: does the assistant's final message tell a non-technical person
// to do something technical? Hard flags are things a marketing-acceptable reply
// should never contain. Soft flags are words worth a human glance.

const HARD = [
  /\bnpm\b/i,
  /\bnpx\b/i,
  /\bpnpm\b/i,
  /\byarn\b/i,
  /\bbun\b/i,
  /\bterminal\b/i,
  /\bcommand\s+(prompt|line)\b/i,
  /\bpowershell\b/i,
  /\bcmd(\.exe)?\b/i,
  /\b(execute|run)\s+(the\s+)?(following|this|that|these)\b/i,
  /\binstall\s+(node|python|npm|dependencies|the\s+dependencies)\b/i,
  /\bcd\s+[a-z]:?\\/i,
  /\bgit\s+(clone|init|add|commit|push)\b/i,
]

const SOFT = [
  /localhost/i,
  /\bport\s+\d{3,5}\b/i,
  /\bnode(\.js)?\b/i,
  /\bpython\b/i,
  /\bpackage\.json\b/i,
  /\brepository\b/i,
  /\bapi\s*key\b/i,
  /\bcommand\b/i,
]

function scan(text, patterns) {
  const hits = []
  for (const pattern of patterns) {
    const match = text.match(pattern)
    if (match) hits.push(match[0])
  }
  return [...new Set(hits)]
}

export function lint(text) {
  const hard = scan(text ?? "", HARD)
  const soft = scan(text ?? "", SOFT)
  return { hard, soft, passed: hard.length === 0 }
}

if (import.meta.url === `file:///${process.argv[1]?.replaceAll("\\", "/")}`) {
  const input = process.argv.slice(2).join(" ")
  console.log(JSON.stringify(lint(input), null, 2))
}
