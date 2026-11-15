import fs from "node:fs"

const MIN_FREE_BYTES = 2 * 1024 * 1024 * 1024 // 2 GB

export interface PreflightResult {
  warnings: string[]
}

export function freeBytes(target: string): number | null {
  try {
    const stats: any = (fs as any).statfsSync?.(target)
    if (!stats) return null
    return Number(stats.bavail) * Number(stats.bsize)
  } catch {
    return null
  }
}

export function preflight(
  target: string,
  options: { free?: () => number | null; minFreeBytes?: number } = {},
): PreflightResult {
  const warnings: string[] = []
  const free = (options.free ?? (() => freeBytes(target)))()
  if (free !== null && free < (options.minFreeBytes ?? MIN_FREE_BYTES)) {
    warnings.push("Your disk is almost full. Big jobs may not finish — it's worth making some room.")
  }
  return { warnings }
}
