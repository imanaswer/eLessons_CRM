import { LocalTime } from '@/components/client.tsx'
import { tenant } from '@/lib/session.ts'

export default async function Exports() {
  const { jobs, me } = await tenant(async (db, c) => ({ me: c.user_id,
    jobs: (await db.query<{ id: string; status: string; row_count: number | null; mask_phone: boolean; requested_at: Date; user_id: string; by: string; filters: object; error: string | null }>(
      `select j.id, j.status, j.row_count, j.mask_phone, j.requested_at, j.user_id, u.display_name as by, j.filters, j.error
       from export_jobs j join users u on u.id = j.user_id order by j.requested_at desc limit 100`)).rows }))
  return (
    <div className="space-y-5">
      <div><h1 className="text-xl font-semibold">Exports</h1><p className="text-sm text-muted">Start an export from the Leads screen. Every export is recorded in the audit log with its filters and row count.</p></div>
      <section className="panel overflow-x-auto">
        <table className="w-full">
          <thead className="border-b border-line"><tr><th className="th">Requested</th><th className="th">By</th><th className="th">Filters</th><th className="th text-right">Rows</th><th className="th">Phones</th><th className="th">Status</th><th className="th" /></tr></thead>
          <tbody className="divide-y divide-line">
            {jobs.map((j) => <tr key={j.id}>
              <td className="td whitespace-nowrap"><LocalTime iso={j.requested_at.toISOString()} /></td><td className="td">{j.by}</td>
              <td className="td max-w-xs truncate text-xs text-muted">{Object.entries(j.filters).filter(([, v]) => v != null).map(([k, v]) => `${k}: ${Array.isArray(v) ? `${v.length} selected` : v}`).join(' · ')}</td>
              <td className="td text-right tabular-nums">{j.row_count ?? '—'}</td><td className="td">{j.mask_phone ? 'Masked' : 'Full'}</td>
              <td className="td"><span className={`chip ${j.status === 'done' ? 'text-ok' : j.status === 'failed' ? 'text-danger' : 'text-muted'}`} title={j.error ?? undefined}>{j.status}</span></td>
              <td className="td text-right">{j.status === 'done' && j.user_id === me && <a className="btn btn-quiet h-8" href={`/exports/${j.id}`}>Download</a>}</td>
            </tr>)}
            {jobs.length === 0 && <tr><td colSpan={7} className="td text-muted">No exports yet.</td></tr>}
          </tbody>
        </table>
      </section>
    </div>
  )
}
