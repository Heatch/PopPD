export interface WaitOptions {
  timeoutMs?: number
  intervalMs?: number
}

/**
 * The engine populates its integration/model catalogs just after startup; a write
 * that arrives too early fails with "Integration not found". Wait for the id to
 * appear instead of guessing a sleep.
 */
export async function waitForId(
  list: () => Promise<string[]>,
  id: string,
  options: WaitOptions = {},
): Promise<boolean> {
  const timeoutMs = options.timeoutMs ?? 15_000
  const intervalMs = options.intervalMs ?? 400
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    try {
      if ((await list()).includes(id)) return true
    } catch {
      // the catalog may not be served yet
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }
  return false
}
