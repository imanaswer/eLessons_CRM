import { ActionForm } from '@/components/form.tsx'
import { money, Page, Table } from '@/components/ui.tsx'
import { tenant } from '@/lib/session.ts'
import { payoutRuleAction } from '../../more-actions.ts'
// EL-8 / brief s31. Commission is applied from payout_rules; the rate is never in code. PLACEHOLDER rates: NEEDED.md.
export default async function Payouts() {
  const d = await tenant(async (db, c) => ({ sa: c.role === 'SUPERADMIN' && !c.read_only,
    report: (await db.query<{ centre_code: string; month: Date; currency: string; enrolments: number; revenue: string; rule_kind: string | null; rate: string | null; commission: string | null }>('select * from payout_report order by month desc, centre_code')).rows,
    rules: (await db.query<{ id: string; centre: string | null; kind: string; rate: string; currency: string | null; valid_from: Date; valid_to: Date | null }>('select p.id, c.code as centre, p.kind, p.rate, p.currency, p.valid_from, p.valid_to from payout_rules p left join centres c on c.id = p.centre_id order by p.valid_from desc')).rows,
    centres: (await db.query<{ id: string; code: string }>('select id, code from centres where is_active order by code')).rows }))
  return <Page title="Centre payouts" sub="Enrolments and revenue credited per centre per month with the commission rule applied.">
    {d.sa && <ActionForm action={payoutRuleAction} submit="Add rule" className="panel grid gap-2 p-4 md:grid-cols-5"><select name="centre_id" className="input" aria-label="Centre"><option value="">Organisation default</option>{d.centres.map((c) => <option key={c.id} value={c.id}>{c.code}</option>)}</select>
      <select name="kind" className="input" aria-label="Kind"><option value="percent">Percent of revenue</option><option value="fixed">Fixed per enrolment</option></select><input name="rate" type="number" step="0.01" className="input" placeholder="Rate" aria-label="Rate" required /><input name="currency" className="input" placeholder="Currency (fixed)" aria-label="Currency" maxLength={3} /><input name="valid_from" type="date" defaultValue={new Date().toISOString().slice(0, 10)} className="input" aria-label="Valid from" /></ActionForm>}
    <Table head={['Month', 'Centre', '#Enrolments', '#Revenue', 'Rule', '#Commission']} empty={d.report.length ? undefined : 'No enrolments yet.'}>
      {d.report.map((r, i) => <tr key={i}><td className="td">{r.month.toISOString().slice(0, 7)}</td><td className="td font-medium">{r.centre_code}</td><td className="td text-right tabular-nums">{r.enrolments}</td><td className="td text-right tabular-nums">{money(r.revenue, r.currency)}</td><td className="td">{r.rule_kind ? `${r.rule_kind} ${r.rate}` : <span className="text-warn">No rule</span>}</td><td className="td text-right tabular-nums">{r.commission != null ? money(r.commission, r.currency) : '—'}</td></tr>)}</Table>
    <Table head={['Centre', 'Kind', '#Rate', 'Valid']} empty={d.rules.length ? undefined : 'No payout rules: commission shows as "No rule" until one is added.'}>{d.rules.map((r) => <tr key={r.id}><td className="td">{r.centre ?? 'All centres (default)'}</td><td className="td">{r.kind}</td><td className="td text-right tabular-nums">{r.rate}{r.kind === 'percent' ? '%' : ` ${r.currency ?? ''}`}</td><td className="td">{r.valid_from.toISOString().slice(0, 10)}{r.valid_to ? ` → ${r.valid_to.toISOString().slice(0, 10)}` : ' →'}</td></tr>)}</Table>
  </Page>
}
