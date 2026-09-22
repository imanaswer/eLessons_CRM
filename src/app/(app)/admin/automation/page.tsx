import { LocalTime } from '@/components/client.tsx'
import { ActionForm } from '@/components/form.tsx'
import { Page, Table } from '@/components/ui.tsx'
import { tenant } from '@/lib/session.ts'
import { automationRuleAction, toggleActiveAction } from '../../more-actions.ts'
const TRIGGERS = ['lead_created', 'lead_assigned', 'repeat_enquiry', 'tag_applied', 'lead_closed', 'call_outcome', 'task_created', 'task_due', 'task_completed', 'deal_stage_changed', 'deal_closed', 'payment_requested', 'payment_received', 'payment_partial', 'payment_failed', 'payment_due', 'demo_completed', 'checkout_started', 'checkout_abandoned', 'conversation_started']
export default async function Automation() {
  const d = await tenant(async (db, c) => ({ claims: c,
    rules: (await db.query<{ id: string; name: string; trigger: string; conditions: unknown[]; actions: { type: string }[]; is_active: boolean; quiet_hours: boolean; scope: string; runs: number; failed: number }>(
      `select r.id, r.name, r.trigger, r.conditions, r.actions, r.is_active, r.quiet_hours, coalesce(c.code, d.code, 'Org') as scope,
              (select count(*) from automation_runs x where x.rule_id = r.id and x.run_at > now() - interval '7 days')::int runs, (select count(*) from automation_runs x where x.rule_id = r.id and x.status = 'failed' and x.run_at > now() - interval '7 days')::int failed
       from automation_rules r left join centres c on c.id = r.centre_id left join districts d on d.id = r.district_id order by r.created_at desc`)).rows,
    failures: (await db.query<{ id: string; rule: string; lead_id: string; detail: unknown; run_at: Date }>("select x.id, r.name as rule, x.lead_id, x.detail, x.run_at from automation_runs x join automation_rules r on r.id = x.rule_id where x.status = 'failed' order by x.id desc limit 30")).rows,
    templates: (await db.query<{ id: string; name: string }>("select id, name from templates where status = 'approved' order by name")).rows,
    lists: (await db.query<{ id: string; name: string }>("select id, name from lists where kind = 'static' order by name limit 100")).rows }))
  const c = d.claims
  return <Page title="Automation" sub="Trigger + conditions + actions. Rules made by HQ apply to every centre and cannot be switched off by a centre. Every run is logged on the lead's timeline.">
    {!c.read_only && <ActionForm action={automationRuleAction} submit="Create rule" className="panel space-y-2 p-4">
      <div className="grid gap-2 md:grid-cols-4"><input name="name" className="input" placeholder="Rule name" aria-label="Name" required /><select name="trigger" className="input" aria-label="Trigger">{TRIGGERS.map((t) => <option key={t}>{t}</option>)}</select>
        <select name="scope" className="input" aria-label="Scope">{c.centre_id ? <option value="centre">This centre</option> : c.district_id ? <option value="district">This district</option> : <><option value="org">Whole organisation</option></>}</select>
        <div className="flex items-center gap-3 text-sm"><label><input type="checkbox" name="quiet_hours" defaultChecked /> Respect calling hours</label><input name="rate_limit" type="number" defaultValue={3} className="input w-20" aria-label="Max runs per lead per day" title="Max runs per lead per day" /></div></div>
      <div className="grid gap-2 md:grid-cols-2"><div><label className="label" htmlFor="conditions">Conditions (JSON array; fields: country, state, city, grade, source, page, campaign, form, lifecycle, disposition, sentiment, tag, hour, attempts, consent, custom.*)</label><textarea id="conditions" name="conditions" rows={3} className="input h-auto py-2 font-mono text-xs" defaultValue='[{"field":"disposition","op":"eq","value":"Demo requested"}]' /></div>
        <div><label className="label" htmlFor="actions">Actions (JSON array)</label><textarea id="actions" name="actions" rows={3} className="input h-auto py-2 font-mono text-xs" defaultValue={JSON.stringify([{ type: 'send_whatsapp', template_id: d.templates[0]?.id ?? 'TEMPLATE_ID' }, { type: 'create_task', title: 'Follow up on demo', due_in_minutes: 1440 }])} /></div></div>
      <details className="text-xs text-muted"><summary className="cursor-pointer">Action reference</summary><pre className="mt-1 whitespace-pre-wrap">{`send_whatsapp {template_id}   send_email {subject, body}   create_task {title, task_type, due_in_minutes}   add_tag {tag}
add_to_list {list_id}   assign / change_owner {user_id}   webhook {url https://…}   notify_user {user_id?, title, body}
Templates: ${d.templates.map((t) => `${t.name}=${t.id}`).join(' · ') || 'none approved yet'}   Lists: ${d.lists.map((l) => `${l.name}=${l.id}`).join(' · ') || 'none'}`}</pre></details>
    </ActionForm>}
    <Table head={['Rule', 'Trigger', 'Scope', 'Actions', '#Runs (7d)', '#Failed', 'Status', '']} empty={d.rules.length ? undefined : 'No rules yet. Seed ideas (AU-2): welcome on new lead, demo link on "Demo requested", nudge 30 min after abandoned checkout, receipt on payment.'}>
      {d.rules.map((r) => <tr key={r.id}><td className="td font-medium">{r.name}{r.quiet_hours && <span className="ml-1 text-xs text-muted">quiet hours</span>}</td><td className="td">{r.trigger}</td><td className="td">{r.scope}</td><td className="td text-muted">{r.actions.map((a) => a.type).join(', ')}{r.conditions.length ? ` · ${r.conditions.length} condition(s)` : ''}</td><td className="td text-right tabular-nums">{r.runs}</td><td className={`td text-right tabular-nums ${r.failed ? 'text-danger' : ''}`}>{r.failed}</td><td className="td"><span className={`chip ${r.is_active ? 'text-ok' : 'text-muted'}`}>{r.is_active ? 'Active' : 'Off'}</span></td>
        <td className="td text-right">{!c.read_only && (r.scope !== 'Org' || !c.centre_id) && <form action={toggleActiveAction}><input type="hidden" name="table" value="automation_rules" /><input type="hidden" name="id" value={r.id} /><input type="hidden" name="active" value={String(!r.is_active)} /><button className="btn btn-quiet h-8">{r.is_active ? 'Disable' : 'Enable'}</button></form>}</td></tr>)}</Table>
    {d.failures.length > 0 && <Table head={['When', 'Rule', 'Lead', 'Detail']}>{d.failures.map((f) => <tr key={f.id}><td className="td"><LocalTime iso={f.run_at.toISOString()} /></td><td className="td">{f.rule}</td><td className="td"><a href={`/leads?view=all&lead=${f.lead_id}`} className="hover:underline">open</a></td><td className="td max-w-md break-words font-mono text-xs text-danger">{JSON.stringify(f.detail)}</td></tr>)}</Table>}
  </Page>
}
