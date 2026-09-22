import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ActionForm } from '@/components/form.tsx'
import { tenant } from '@/lib/session.ts'
import { startImportAction } from '../../actions.ts'

const FIELDS = [['phone', 'Phone (required)', /phone|mobile|contact|whats/i], ['name', 'Parent name', /parent|^name|full.?name|lead/i], ['email', 'Email', /mail/i], ['city', 'City', /city|town/i],
  ['state', 'State', /state/i], ['student_name', 'Student name', /student|child|kid/i], ['grade', 'Grade', /grade|class|std/i], ['stream', 'Stream', /stream/i], ['school', 'School', /school/i]] as const
const OUTCOME: Record<string, string> = { created: 'Success', duplicate: 'Duplicate', dnc: 'Do Not Contact', invalid: 'Invalid' }

export default async function ImportBatch({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound()
  const d = await tenant(async (db) => {
    const { rows: [b] } = await db.query<{ id: string; filename: string; headers: string[]; status: string; row_count: number; list_id: string | null }>('select id, filename, headers, status, row_count, list_id from import_batches where id = $1', [id])
    if (!b) return null
    const sample = await db.query<{ payload: Record<string, string> }>('select payload from inbound_events where import_batch_id = $1 order by external_event_id::int limit 5', [id])
    const counts = await db.query<{ k: string; n: number }>(
      `select coalesce(outcome, case when processing_status in ('failed','dead') then 'error' else 'waiting' end) as k, count(*)::int n from inbound_events where import_batch_id = $1 group by 1`, [id])
    return { b, sample: sample.rows.map((r) => r.payload), counts: Object.fromEntries(counts.rows.map((r) => [r.k, r.n])) }
  })
  if (!d) notFound()
  const { b } = d
  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3"><h1 className="truncate text-xl font-semibold">{b.filename}</h1><Link href="/leads/import" className="btn btn-quiet">All imports</Link></div>
      {b.status === 'mapping' ? <>
        <section className="panel overflow-x-auto">
          <p className="panel-head text-[11px] font-semibold uppercase tracking-[0.06em] text-muted">Preview · first {d.sample.length} of {b.row_count} rows</p>
          <table className="w-full"><thead><tr>{b.headers.map((h) => <th key={h} className="th">{h}</th>)}</tr></thead>
            <tbody className="divide-y divide-line">{d.sample.map((r, i) => <tr key={i}>{b.headers.map((h) => <td key={h} className="td whitespace-nowrap">{r[h]}</td>)}</tr>)}</tbody></table>
        </section>
        <ActionForm action={startImportAction} submit={`Validate and import ${b.row_count} rows`} className="panel space-y-3 p-4">
          <input type="hidden" name="batch_id" value={b.id} />
          <p className="text-[13px] text-muted">Match your columns to lead fields. We guessed where we could.</p>
          <div className="grid gap-3 sm:grid-cols-3">
            {FIELDS.map(([key, label, guess]) => (
              <div key={key}><label className="label" htmlFor={key}>{label}</label>
                <select id={key} name={key} className="input" defaultValue={b.headers.find((h) => guess.test(h)) ?? ''} required={key === 'phone'}>
                  <option value="">Don&apos;t import</option>{b.headers.map((h) => <option key={h}>{h}</option>)}</select></div>
            ))}
          </div>
        </ActionForm>
      </> : <>
        <dl className="panel grid grid-cols-2 divide-x divide-y divide-line sm:grid-cols-5 sm:divide-y-0">
          {Object.entries(OUTCOME).map(([k, label]) => <div key={k} className="px-4 py-3"><dt className="text-xs text-muted">{label}</dt><dd className="text-2xl font-semibold tabular-nums">{d.counts[k] ?? 0}</dd></div>)}
          <div className="px-4 py-3"><dt className="text-xs text-muted">{b.status === 'done' ? 'Errors' : 'Waiting'}</dt><dd className="text-2xl font-semibold tabular-nums">{b.status === 'done' ? d.counts.error ?? 0 : (d.counts.waiting ?? 0) + (d.counts.error ?? 0)}</dd></div>
        </dl>
        {b.status === 'processing' && <p className="text-[13px] text-muted">Import is running in the background. <Link href={`/leads/import/${b.id}`} className="text-brand underline">Refresh</Link> to update the counts.</p>}
        {(d.counts.error ?? 0) > 0 && <p role="alert" className="text-sm text-danger">Some rows were received but processing failed. They are kept and will be retried; HQ can replay them from Admin › Inbound events.</p>}
        {b.list_id && <Link href={`/leads?view=active&list=${b.list_id}`} className="btn btn-primary">View imported leads</Link>}
      </>}
    </div>
  )
}
