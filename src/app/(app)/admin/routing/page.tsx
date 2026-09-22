import { ActionForm } from '@/components/form.tsx'
import { Page, Table } from '@/components/ui.tsx'
import { tenant } from '@/lib/session.ts'
import { fallbackAction, routePreviewAction, routingRuleAction, toggleActiveAction } from '../../more-actions.ts'
// AS-2..5: rules, ordered evaluation, fallback owner, coverage banner and the "Where would this lead go?" tool.
export default async function Routing() {
  const d = await tenant(async (db, c) => ({ ro: c.read_only, hq: c.centre_id === null && c.district_id === null,
    rules: (await db.query<{ id: string; name: string; priority: number; is_active: boolean; conditions: { field: string; op: string; value: unknown }[]; method: string; targets: string[] }>(
      `select r.id, r.name, r.priority, r.is_active, r.conditions, r.method, case r.method when 'round_robin_centres' then (select array_agg(code order by code) from centres where id = any(r.target_centre_ids)) else (select array_agg(display_name) from users where id = any(r.target_user_ids)) end as targets from distribution_rules r order by r.priority, r.created_at`)).rows,
    coverage: c.centre_id === null && c.district_id === null ? (await db.query<{ l1: string; l2: string; lead_count: number; last_seen_at: Date; rule: string | null }>('select * from app.coverage()')).rows : [],
    centres: (await db.query<{ id: string; code: string }>('select id, code from centres where is_active and accepts_inbound order by code')).rows,
    users: (await db.query<{ id: string; display_name: string; scope: string }>("select u.id, u.display_name, coalesce(c.code, 'HQ') as scope from users u left join centres c on c.id = u.centre_id where u.is_active and u.role in ('COUNSELLOR','CENTRE_ADMIN','HQ_COUNSELLOR') order by 3, 2")).rows,
    fallback: (await db.query<{ id: string | null }>('select fallback_owner_id as id from orgs')).rows[0]?.id ?? null }))
  if (!d.hq) return <Page title="Routing"><p className="text-[13px] text-muted">You don&apos;t have permission to access this. Routing rules are managed by HQ.</p></Page>
  const gaps = d.coverage.filter((c) => !c.rule)
  return <Page title="Routing" sub="Leads from a centre's own sources need no rule. HQ sources are routed by the first matching rule in priority order, else the fallback owner, else they wait in the HQ pool.">
    {gaps.length > 0 && <p role="alert" className="rounded-md border border-line bg-amber-50 px-3 py-2 text-sm text-warn">{gaps.length} HQ source{gaps.length > 1 ? 's have' : ' has'} no routing rule: {gaps.map((g) => `${g.l1}${g.l2 ? ' › ' + g.l2 : ''}`).join(', ')}. Leads from them land in the HQ pool unassigned.</p>}
    <div className="grid gap-4 lg:grid-cols-2">
      {!d.ro && <ActionForm action={routingRuleAction} submit="Add rule" className="panel space-y-2 p-4"><h2 className="text-[14px] font-semibold">New rule</h2>
        <div className="grid grid-cols-2 gap-2"><input name="name" className="input" placeholder="Name" aria-label="Name" required /><input name="priority" type="number" defaultValue={100} className="input" aria-label="Priority (lower runs first)" title="Priority: lower runs first" /></div>
        <div className="grid grid-cols-3 gap-2"><select name="field" className="input" aria-label="Condition field"><option value="">Any lead</option>{['country', 'state', 'city', 'grade', 'source', 'page', 'campaign', 'form', 'language'].map((f) => <option key={f}>{f}</option>)}</select><select name="op" className="input" aria-label="Operator"><option value="eq">is</option><option value="neq">is not</option><option value="in">is one of (comma-separated)</option></select><input name="value" className="input" placeholder="Value" aria-label="Value" /></div>
        <select name="method" className="input" aria-label="Method"><option value="round_robin_centres">Round-robin among centres</option><option value="round_robin_users">Round-robin among users</option></select>
        <div className="grid grid-cols-2 gap-2 text-sm"><fieldset className="max-h-40 overflow-y-auto rounded-md border border-line p-2"><legend className="px-1 text-xs text-muted">Centres</legend>{d.centres.map((c) => <label key={c.id} className="block"><input type="checkbox" name="centre_ids" value={c.id} /> {c.code}</label>)}</fieldset>
          <fieldset className="max-h-40 overflow-y-auto rounded-md border border-line p-2"><legend className="px-1 text-xs text-muted">Users</legend>{d.users.map((u) => <label key={u.id} className="block"><input type="checkbox" name="user_ids" value={u.id} /> {u.display_name} <span className="text-muted">({u.scope})</span></label>)}</fieldset></div></ActionForm>}
      <div className="space-y-4">
        <ActionForm action={routePreviewAction} submit="Where would it go?" className="panel space-y-2 p-4"><h2 className="text-[14px] font-semibold">Diagnose</h2><p className="text-[13px] text-muted">Describe a lead; see which rule catches it. Nothing is saved.</p>
          <div className="grid grid-cols-2 gap-2"><input name="state" className="input" placeholder="State" aria-label="State" /><input name="city" className="input" placeholder="City" aria-label="City" /><input name="country" className="input" placeholder="Country (IN)" aria-label="Country" maxLength={2} /><input name="grade" className="input" placeholder="Grade" aria-label="Grade" /><input name="source" className="input col-span-2" placeholder="Source channel (Website, Meta…)" aria-label="Source" /></div></ActionForm>
        {!d.ro && <form action={fallbackAction} className="panel flex items-end gap-2 p-4"><div className="flex-1"><label className="label" htmlFor="fallback_owner_id">Fallback owner (no rule matched)</label><select id="fallback_owner_id" name="fallback_owner_id" defaultValue={d.fallback ?? ''} className="input"><option value="">None: wait in HQ pool</option>{d.users.map((u) => <option key={u.id} value={u.id}>{u.display_name} ({u.scope})</option>)}</select></div><button className="btn btn-quiet">Save</button></form>}
      </div>
    </div>
    <Table head={['#Priority', 'Rule', 'Conditions', 'Targets', 'Status', '']} empty={d.rules.length ? undefined : 'No rules yet.'}>
      {d.rules.map((r) => <tr key={r.id}><td className="td text-right tabular-nums">{r.priority}</td><td className="td font-medium">{r.name}</td><td className="td text-muted">{r.conditions.length ? r.conditions.map((k) => `${k.field} ${k.op} ${Array.isArray(k.value) ? k.value.join(', ') : String(k.value)}`).join(' AND ') : 'any lead'}</td><td className="td">{r.method === 'round_robin_centres' ? 'Centres: ' : 'Users: '}{(r.targets ?? []).join(', ')}</td><td className="td"><span className={`chip ${r.is_active ? 'text-ok' : 'text-muted'}`}>{r.is_active ? 'Active' : 'Off'}</span></td>
        <td className="td text-right">{!d.ro && <form action={toggleActiveAction}><input type="hidden" name="table" value="distribution_rules" /><input type="hidden" name="id" value={r.id} /><input type="hidden" name="active" value={String(!r.is_active)} /><button className="btn btn-quiet h-8">{r.is_active ? 'Disable' : 'Enable'}</button></form>}</td></tr>)}
    </Table>
    <Table head={['HQ source', '#Leads', 'Last seen', 'Rule']} empty={d.coverage.length ? undefined : 'No HQ-scoped sources seen yet.'}>
      {d.coverage.map((c, i) => <tr key={i}><td className="td">{c.l1}{c.l2 ? ` › ${c.l2}` : ''}</td><td className="td text-right tabular-nums">{c.lead_count}</td><td className="td text-muted">{c.last_seen_at.toISOString().slice(0, 10)}</td><td className="td">{c.rule ?? <span className="text-warn">No rule</span>}</td></tr>)}
    </Table>
  </Page>
}
