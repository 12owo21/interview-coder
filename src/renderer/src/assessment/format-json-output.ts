/** Only format complete JSON (optionally fenced); keep partial/invalid output verbatim. */
export function formatJsonOutput(raw: string): { text: string; formatted: boolean } {
  const trimmed = raw.trim()
  const fenced = /^```(?:json)?\s*\n?([\s\S]*?)\s*```$/i.exec(trimmed)
  try {
    return { text: JSON.stringify(JSON.parse(fenced?.[1] ?? trimmed), null, 2), formatted: true }
  } catch {
    return { text: raw, formatted: false }
  }
}
