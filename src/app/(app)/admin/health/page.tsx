import Link from 'next/link'
import { Chip, Page, STATE_TONE, Table } from '@/components/ui.tsx'
import { tenant } from '@/lib/session.ts'
// System health: queues, dead letters, integration states, worker liveness. Numbers link to the screens that fix them.
export default async function Health() {
  const d = await tenant(async (db) => ({
    q: (await db.query(`select (select count(*) from inbound_events where processing_status in ('pending','processing'))::int inbound_waiting, (select count(*) from inbound_events where processing_status = 'failed')::int inbound_failed, (select count(*) from inbound_events where processing_status = 'dead')::int inbound_dead,
      (select max(processed_at) from inbound_events) last_processed, (select count(*) from export_jobs where status in ('queued','running'))::int exports, (select count(*) from conversion_events where status in ('failed','dead'))::int capi_failed,
      (select count(*) from webhook_deliveries where status in ('failed','dead'))::int hooks_failed, (select count(*) from automation_runs where status = 'failed' and run_at > now() - interval '1 day')::int auto_failed,
      (select count(*) from notifications where pushed_at is null)::int push_waiting, (select count(*) from broadcasts where status = 'running')::int broadcasts_running`)).rows[0],
    conns: (await db.query<{ state: string; n: number }>('select state, count(*)::int n from connection_list group by 1 order by 1')).rows,
    problems: (await db.query<{ id: string; name: string; centre_code: string | null; state: string; last_error: string | null }>("select id, name, centre_code, state, last_error from connection_list where state in ('Reconnect','Action needed','Stale','Mapping pending') order by state")).rows }))
  const q = d.q, stale = !q.last_processed || (Date.now() - +q.last_processed > 10 * 60e3)
  return <Page title="System health">
    {stale && q.inbound_waiting > 0 && <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-danger">Inbound events are waiting but nothing has been processed for over 10 minutes. The worker is probably not running (`pnpm worker`).</p>}
    <dl className="grid grid-cols-2 divide-x divide-y divide-line overflow-hidden panel md:grid-cols-5">
      {[['Inbound waiting', q.inbound_waiting, '/admin/inbound?status=pending'], ['Inbound failed', q.inbound_failed, '/admin/inbound'], ['Dead-letter', q.inbound_dead, '/admin/inbound'], ['Exports running', q.exports, '/exports'], ['CAPI failed', q.capi_failed, '/integrations'], ['Webhooks failed', q.hooks_failed, '/integrations'], ['Automation failed (24h)', q.auto_failed, '/admin/automation'], ['Push waiting', q.push_waiting, '/notifications'], ['Broadcasts running', q.broadcasts_running, '/admin/broadcasts'], ['Last event processed', q.last_processed ? new Date(q.last_processed).toISOString().slice(11, 19) + ' UTC' : 'never', '/admin/inbound']].map(([l, v, h]) =>
        <Link key={String(l)} href={String(h)} className="block px-4 py-3 hover:bg-canvas"><dt className="text-xs text-muted">{l}</dt><dd className={`text-xl font-semibold tabular-nums ${Number(v) > 0 && /failed|Dead/.test(String(l)) ? 'text-danger' : ''}`}>{v}</dd></Link>)}</dl>
    <div className="grid gap-4 md:grid-cols-2"><Table head={['Integration state', '#Connections']} empty={d.conns.length ? undefined : 'No connections.'}>{d.conns.map((c) => <tr key={c.state}><td className="td"><Chip tone={STATE_TONE[c.state]}>{c.state}</Chip></td><td className="td text-right tabular-nums">{c.n}</td></tr>)}</Table>
      <Table head={['Needs attention', 'Centre', 'State', 'Error']} empty={d.problems.length ? undefined : 'Every connection is healthy.'}>{d.problems.map((p) => <tr key={p.id}><td className="td font-medium">{p.name}</td><td className="td">{p.centre_code ?? 'HQ'}</td><td className="td"><Chip tone={STATE_TONE[p.state]}>{p.state}</Chip></td><td className="td max-w-xs truncate text-xs text-muted">{p.last_error}</td></tr>)}</Table></div>
  </Page>
}
