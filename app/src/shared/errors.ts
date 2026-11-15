/**
 * Turns raw engine/provider failures into something a non-technical person can act on.
 */
export function friendlyError(raw?: string): string {
  const text = (raw ?? "").toLowerCase()
  if (/401|403|unauthor|forbidden|invalid api key|authentication|api key/.test(text)) {
    return "Your key may have expired. Open Settings and paste a fresh one."
  }
  if (/429|rate limit|quota|too many requests/.test(text)) {
    return "PopPD is being asked to do too much right now. Wait a minute and try again."
  }
  if (/timeout|timed out|etimedout|econnreset|fetch failed|network|socket/.test(text)) {
    return "The connection dropped. Try again — your files are safe."
  }
  if (/enospc|no space|disk full/.test(text)) {
    return "There isn't enough space on the disk for that one. Free some room and try again."
  }
  if (/out of memory|heap|oom/.test(text)) {
    return "That job needed more memory than the builder had. Try something smaller."
  }
  return "Something went wrong while making that. Your files are safe — try again."
}
