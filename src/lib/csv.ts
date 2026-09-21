// RFC 4180: quoted fields, escaped quotes, CRLF, BOM. ponytail: whole file in memory; uploads are capped at 10 MB.
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [[]]; let cell = '', quoted = false
  const src = text.replace(/^﻿/, '')
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!
    if (quoted) { if (ch === '"') { if (src[i + 1] === '"') { cell += '"'; i++ } else quoted = false } else cell += ch }
    else if (ch === '"') quoted = true
    else if (ch === ',') { rows.at(-1)!.push(cell); cell = '' }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && src[i + 1] === '\n') i++; rows.at(-1)!.push(cell); cell = ''; rows.push([]) }
    else cell += ch
  }
  rows.at(-1)!.push(cell)
  return rows
}
