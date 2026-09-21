import Link from 'next/link'
import { LocalTime } from '@/components/client.tsx'
import { ActionForm } from '@/components/form.tsx'
import { tenant } from '@/lib/session.ts'
import { uploadImportAction } from '../actions.ts'

export default async function Imports() {
  const d = await tenant(async (db, c) => ({
    ro: c.read_only,
    centres: c.centre_id ? [] : (await db.query<{ id: string; code: string }>('select id, code from centres where is_active and accepts_inbound order by code')).rows,
    batches: (await db.query<{ id: string; filename: string; status: string; row_count: number; created_at: Date; centre: string | null; by: string | null }>(
      `select b.id, b.filename, b.status, b.row_count, b.created_at, c.code as centre, u.display_name as by from import_batches b
       left join centres c on c.id = b.centre_id left join users u on u.id = b.created_by order by b.created_at desc limit 50`)).rows,
  }))
  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between"><h1 className="text-xl font-semibold">Import leads</h1><Link href="/leads" className="btn btn-quiet">Back to leads</Link></div>
      {!d.ro && <ActionForm action={uploadImportAction} submit="Upload and map columns" className="panel space-y-3 p-4">
        <p className="text-sm text-muted">CSV or XLSX, first row as headers, up to 20,000 rows. Every row passes the same checks as a manually entered lead: duplicates, Do Not Contact and invalid numbers are reported, not imported.</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <div><label className="label" htmlFor="file">File</label><input id="file" name="file" type="file" accept=".csv,.xlsx" required className="block w-full text-sm" /></div>
          {d.centres.length > 0 && <div><label className="label" htmlFor="centre_id">Import into centre</label><select id="centre_id" name="centre_id" className="input" required>{d.centres.map((c) => <option key={c.id} value={c.id}>{c.code}</option>)}</select></div>}
        </div>
      </ActionForm>}
      <section className="panel overflow-x-auto">
        <table className="w-full">
          <thead className="border-b border-line"><tr><th className="th">File</th><th className="th">Centre</th><th className="th text-right">Rows</th><th className="th">Status</th><th className="th">Uploaded</th></tr></thead>
          <tbody className="divide-y divide-line">
            {d.batches.map((b) => <tr key={b.id}><td className="td"><Link className="font-medium hover:underline" href={`/leads/import/${b.id}`}>{b.filename}</Link></td><td className="td">{b.centre}</td>
              <td className="td text-right tabular-nums">{b.row_count}</td><td className="td"><span className="chip">{b.status === 'mapping' ? 'Needs mapping' : b.status}</span></td>
              <td className="td text-muted">{b.by} · <LocalTime iso={b.created_at.toISOString()} /></td></tr>)}
            {d.batches.length === 0 && <tr><td colSpan={5} className="td text-muted">No imports yet.</td></tr>}
          </tbody>
        </table>
      </section>
    </div>
  )
}
