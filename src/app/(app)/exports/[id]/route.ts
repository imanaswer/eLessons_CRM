import { createReadStream, existsSync } from 'node:fs'
import { resolve, sep } from 'node:path'
import { Readable } from 'node:stream'
import { tenant } from '@/lib/session.ts'

// ponytail: local disk. Swap for a signed object-storage URL when STORAGE_* is configured (DEPLOYMENT.md).
const DIR = resolve(process.env.EXPORT_DIR ?? 'storage/exports')

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!/^[0-9a-f-]{36}$/.test(id)) return new Response('Not found', { status: 404 })
  // only the requester downloads; the row is fetched under their RLS and the download itself is audited
  const path = await tenant(async (db, c) => {
    const { rows: [j] } = await db.query<{ file_path: string }>("select file_path from export_jobs where id = $1 and user_id = $2 and status = 'done'", [id, c.user_id])
    if (j) await db.query("select app.audit('export.downloaded', 'export_jobs', $1)", [id])
    return j?.file_path
  })
  const file = path && resolve(path)
  if (!file || !file.startsWith(DIR + sep) || !existsSync(file)) return new Response('Not found', { status: 404 })
  return new Response(Readable.toWeb(createReadStream(file)) as ReadableStream, {
    headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="leads-${id.slice(0, 8)}.csv"`, 'Cache-Control': 'private, no-store' },
  })
}
