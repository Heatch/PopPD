export function parseModel(ref: string): { providerID: string; id: string; variant?: string } {
  const slash = ref.indexOf("/")
  if (slash < 0) throw new Error(`model must be provider/model, got ${ref}`)
  const providerID = ref.slice(0, slash)
  const [id, variant] = ref.slice(slash + 1).split("#")
  return variant ? { providerID, id, variant } : { providerID, id }
}

export function modelHint(id: string): string | undefined {
  if (/flash/i.test(id)) return "Fast · default"
  if (/pro/i.test(id)) return "Stronger · slower"
  return undefined
}

const PRICES: Array<{ test: RegExp; input: number; output: number }> = [
  { test: /deepseek-v4\.1-flash/i, input: 0.15, output: 0.6 },
  { test: /deepseek-v4-pro/i, input: 0.66, output: 1.98 },
  { test: /kimi-k2\.7-code/i, input: 0.95, output: 4 },
  { test: /kimi-k3/i, input: 2, output: 10 },
]

export function estimateCostUsd(model: string, input: number, output: number): number {
  const price = PRICES.find((entry) => entry.test.test(model)) ?? { input: 0.15, output: 0.6 }
  return Number(((input * price.input + output * price.output) / 1_000_000).toFixed(4))
}
