import Link from 'next/link'
import { LocalTime } from '@/components/client.tsx'
import { tenant } from '@/lib/session.ts'
import { replayEventAction } from '../../leads/actions.ts'

// IN-1 / brief s8: every failed inbound event is visible and replayable. Nothing is silently dropped.
export default async function Inbound({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const status = ['problems', 'pending', 'processed'].includes((await searchParams).status ?? '') ? (await searchParams).status! : 'problems'
  const d = await tenant(async (db, c) => ({
    ro: c.read_only,
    counts: (await db.query<{ s: string; n: number }>("select processing_status as s, count(*)::int n from inbound_events where received_at > now() - interval '30 days' group by 1")).rows,
    rows: (await db.query<{ id: string; channel: string; centre: string | null; processing_status: string; outcome: string | null; retry_count: number; error: string | null; received_at: Date; next_retry_at: Date }>(
      `select e.id, e.channel, c.code as centre, e.processing_status, e.outcome, e.retry_count, e.error, e.received_at, e.next_retry_at
       from inbound_events e left join centres c on c.id = e.centre_id
       where case $1 when 'problems' then e.processing_status in ('failed','dead') when 'pending' then e.processing_status in ('pending','processing','held') else e.processing_status = 'processed' end
       order by e.received_at desc limit 100`, [status])).rows,
  }))
  const n = (s: string) => d.counts.find((c) => c.s === s)?.n ?? 0
  return (
    <div className="space-y-5">
      <div><h1 className="text-[22px] font-semibold leading-tight">Inbound events</h1><p className="text-[13px] text-muted">Every lead from every source is stored here before it is processed. Last 30 days.</p></div>
      <nav className="flex gap-2 text-sm">
        {[['problems', `Failed ${n('failed')} · Dead-letter ${n('dead')}`], ['pending', `Waiting ${n('pending') + n('processing') + n('held')}`], ['processed', `Processed ${n('processed')}`]].map(([k, label]) =>
          <Link key={k} href={`?status=${k}`} aria-current={status === k ? 'page' : undefined} className="seg">{label}</Link>)}
      </nav>
      <section className="panel overflow-x-auto">
        <table className="w-full">
          <thead className="border-b border-line"><tr><th className="th">Received</th><th className="th">Source</th><th className="th">Centre</th><th className="th">Status</th><th className="th">Detail</th><th className="th" /></tr></thead>
          <tbody className="divide-y divide-line">
            {d.rows.map((e) => <tr key={e.id} className="align-top">
              <td className="td whitespace-nowrap"><LocalTime iso={e.received_at.toISOString()} /></td><td className="td">{e.channel}</td><td className="td">{e.centre ?? 'HQ'}</td>
              <td className="td"><span className={`chip ${e.processing_status === 'dead' ? 'text-danger' : e.processing_status === 'failed' ? 'text-warn' : 'text-muted'}`}>{e.processing_status === 'dead' ? 'dead-letter' : e.processing_status}</span></td>
              <td className="td max-w-md text-xs text-muted">{e.error ? <>Event received but processing failed. {e.processing_status === 'failed' && <>Retry {e.retry_count} scheduled <LocalTime iso={e.next_retry_at.toISOString()} />. </>}<span className="break-words font-mono">{e.error.slice(0, 200)}</span></> : e.outcome}</td>
              <td className="td text-right">{['failed', 'dead'].includes(e.processing_status) && !d.ro && <form action={replayEventAction}><input type="hidden" name="event_id" value={e.id} /><button className="btn btn-quiet h-8">Retry now</button></form>}</td>
            </tr>)}
            {d.rows.length === 0 && <tr><td colSpan={6} className="td text-muted">{status === 'problems' ? 'No failed events. Every inbound lead was processed.' : 'Nothing here.'}</td></tr>}
          </tbody>
        </table>
      </section>
    </div>
  )
}
