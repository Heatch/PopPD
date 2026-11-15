const LINES: Record<string, string> = {
  write: "Building it…",
  edit: "Building it…",
  patch: "Building it…",
  shell: "Running a quick check…",
  read: "Looking over what I made…",
  glob: "Looking over what I made…",
  grep: "Looking over what I made…",
  webfetch: "Looking something up…",
  websearch: "Looking something up…",
  skill: "Using a handy trick…",
  task: "Getting a second pair of eyes…",
  subagent: "Getting a second pair of eyes…",
  open_with_default_app: "Opening your result…",
  show_in_folder: "Finding the file…",
  escalate: "Writing up what's needed…",
}

export function friendlyLine(tool?: string): string {
  if (!tool) return "Thinking it through…"
  return LINES[tool] ?? "Working on it…"
}

export function toolsLine(tools: string[]): string {
  const last = [...tools].reverse().find((tool) => LINES[tool])
  return friendlyLine(last)
}

export function elapsedText(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  return `${minutes}m ${seconds % 60}s`
}
