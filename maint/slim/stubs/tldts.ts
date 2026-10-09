const SECOND_LEVEL = new Set(['ac', 'co', 'com', 'edu', 'gov', 'net', 'org'])

export function getDomain(hostname: string): string | null {
  const labels = hostname.toLowerCase().replace(/\.$/, '').split('.')
  if (labels.length < 2 || labels.includes('')) return null
  const [second, top] = labels.slice(-2)
  const size = labels.length > 2 && top.length === 2 && SECOND_LEVEL.has(second) ? 3 : 2
  return labels.slice(-size).join('.')
}
