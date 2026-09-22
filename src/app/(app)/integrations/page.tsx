import Link from 'next/link'
import { LocalTime } from '@/components/client.tsx'
import { ActionForm } from '@/components/form.tsx'
import { Chip, Page, STATE_TONE, Table } from '@/components/ui.tsx'
import { tenant } from '@/lib/session.ts'
import { connectionPatchAction, createConnectionAction, saveMappingAction, syncFormsAction } from '../more-actions.ts'
import { metaStartAction } from './actions.ts'
// PRD s9: Connect / Receive / Map / Health. HQ sees all connections (IN-2); a centre only its own (IN-3).
export default async function Integrations({ searchParams }: { searchParams: Promise<{ state?: string; map?: string }> }) {
  const sp = await searchParams
  const d = await tenant(async (db, c) => ({ claims: c,
    rows: (await db.query<{ id: string; kind: string; name: string; state: string; status: string; external_id: string | null; centre_code: string | null; config: Record<string, string>; last_event_at: Date | null; last_error: string | null; token_expires_at: Date | null; forms: { form_id: string; name: string; status: string }[] }>(
      `select l.*, coalesce((select json_agg(json_build_object('form_id', f.form_id, 'name', f.name, 'status', f.status)) from connection_forms f where f.connection_id = l.id), '[]') as forms
       from connection_list l where ($1::text is null or l.state = $1) order by l.centre_code nulls first, l.kind, l.name`, [sp.state ?? null])).rows,
    centres: c.centre_id ? [] : (await db.query<{ id: string; code: string }>('select id, code from centres where is_active order by code')).rows,
    mapping: sp.map ? (await db.query<{ form_id: string; mapping: Record<string, string> }>('select form_id, mapping from field_mappings where connection_id = $1', [sp.map])).rows : [],
    metaReady: !!process.env.META_APP_ID && !!process.env.META_APP_SECRET }))
  const ro = d.claims.read_only, hq = !d.claims.centre_id
  const meta = d.rows.find((r) => r.id === sp.map)
  return <Page title="Integrations" sub={hq ? 'Every connection across all centres.' : 'Your centre\'s connections only.'}>
    {!ro && <section className="grid gap-4 md:grid-cols-2">
      <div className="panel p-4"><h2 className="text-[14px] font-semibold">Facebook page (Meta Lead Ads)</h2><p className="mt-1 text-sm text-muted">Connect your page, sync its lead forms, and every lead from that page lands in your centre automatically. One G-TEC Meta app is used for all centres.</p>
        {d.metaReady ? <form action={metaStartAction} className="mt-3 flex gap-2">{hq && <select name="centre_id" className="input w-auto" aria-label="Centre" required>{d.centres.map((c) => <option key={c.id} value={c.id}>{c.code}</option>)}</select>}<button className="btn btn-primary">Connect Facebook page</button></form>
          : <p className="mt-3 rounded-md bg-amber-50 px-3 py-2 text-sm text-warn">META_APP_ID / META_APP_SECRET are not configured yet, and the Meta app review must be approved first (NEEDED.md).</p>}</div>
      <ActionForm action={createConnectionAction} submit="Create" className="panel space-y-2 p-4"><h2 className="text-[14px] font-semibold">Other connection</h2>
        <div className="grid grid-cols-2 gap-2"><select name="kind" className="input" aria-label="Kind"><option value="api">Generic API (bearer key)</option><option value="website">Website forms (elessons.net)</option><option value="lms">LMS events</option><option value="google_ads">Google Ads lead form webhook</option>{hq && <option value="payment">Payment gateway</option>}{hq && <option value="whatsapp">WhatsApp Cloud API number</option>}{hq && <option value="outbound_webhook">Outbound webhook</option>}</select>
          <input name="name" className="input" placeholder="Name" aria-label="Name" required />{hq && <select name="centre_id" className="input" aria-label="Centre"><option value="">HQ-scoped</option>{d.centres.map((c) => <option key={c.id} value={c.id}>{c.code}</option>)}</select>}
          <select name="gateway" className="input" aria-label="Gateway (payment)"><option value="generic">Gateway: generic</option><option value="razorpay">Razorpay</option><option value="stripe">Stripe</option></select>
          <input name="url" className="input" placeholder="https:// (outbound webhook)" aria-label="URL" /><input name="phone_number_id" className="input" placeholder="WhatsApp phone_number_id" aria-label="Phone number id" /><input name="token" type="password" className="input" placeholder="WhatsApp permanent token" aria-label="Token" autoComplete="off" /></div>
        <p className="text-xs text-muted">API keys and secrets are shown once and stored encrypted.</p></ActionForm>
    </section>}
    <Table head={['Connection', 'Scope', 'Health', 'Last event', 'Detail', '']} empty={d.rows.length ? undefined : 'No connections yet.'}>
      {d.rows.map((r) => <tr key={r.id} className="align-top"><td className="td"><span className="font-medium">{r.name}</span><div className="text-xs text-muted">{r.kind}{r.external_id ? ` · ${r.external_id}` : ''}</div></td><td className="td">{r.centre_code ?? 'HQ'}</td>
        <td className="td"><Chip tone={STATE_TONE[r.state]}>{r.state}</Chip>{r.token_expires_at && <div className="text-xs text-muted">token expires {r.token_expires_at.toISOString().slice(0, 10)}</div>}</td><td className="td">{r.last_event_at ? <LocalTime iso={r.last_event_at.toISOString()} /> : '—'}</td>
        <td className="td max-w-md text-xs">{r.state === 'Reconnect' && <p className="text-danger">Facebook connection expired. Reconnect to continue receiving leads.</p>}{r.last_error && <p className="break-words text-muted">{r.last_error.slice(0, 200)}</p>}
          {r.kind === 'meta_page' && r.forms.length > 0 && <p className="text-muted">Forms: {r.forms.map((f) => f.name).join(', ')}</p>}
          {r.kind === 'meta_page' && !ro && <form action={connectionPatchAction} className="mt-1 flex flex-wrap gap-1"><input type="hidden" name="id" value={r.id} /><input name="pixel_id" defaultValue={r.config.pixel_id ?? ''} className="input h-7 w-32 text-xs" placeholder="Dataset (pixel) id" aria-label="Pixel id" /><input name="ad_account_id" defaultValue={r.config.ad_account_id ?? ''} className="input h-7 w-32 text-xs" placeholder="Ad account id" aria-label="Ad account id" /><button className="btn btn-quiet h-7">Save</button></form>}
          {r.kind === 'website' && <p className="text-muted">POST {`{event, phone, email, ...}`} to /api/webhooks/site with the bearer key. Referral: pass ref or coupon.</p>}{r.kind === 'payment' && <p className="text-muted">Webhook: /api/webhooks/payment?gateway={r.config.gateway ?? 'generic'} · X-Signature = HMAC-SHA256(raw body)</p>}{r.kind === 'api' && <p className="text-muted">POST /api/v1/leads with Authorization: Bearer &lt;key&gt;</p>}</td>
        <td className="td"><div className="flex flex-wrap justify-end gap-1">
          {r.kind === 'meta_page' && r.status === 'connected' && !ro && <><form action={syncFormsAction}><input type="hidden" name="connection_id" value={r.id} /><button className="btn btn-quiet h-8">Sync forms</button></form><Link href={`?map=${r.id}`} className="btn btn-quiet h-8">Map</Link></>}
          {r.state === 'Reconnect' && d.metaReady && !ro && <form action={metaStartAction}><input type="hidden" name="connection_id" value={r.id} /><button className="btn btn-primary h-8">Reconnect</button></form>}
          {!ro && <form action={connectionPatchAction}><input type="hidden" name="id" value={r.id} /><input type="hidden" name="status" value={r.status === 'disabled' ? 'connected' : 'disabled'} /><button className="btn btn-quiet h-8">{r.status === 'disabled' ? 'Enable' : 'Disable'}</button></form>}</div></td></tr>)}
    </Table>
    {meta && <section className="panel p-4"><h2 className="text-[14px] font-semibold">Map fields · {meta.name}</h2><p className="text-[13px] text-muted">Standard Meta questions (full_name, phone_number, email, city…) map automatically. Map custom questions here; the key is the question&apos;s field name in Meta.</p>
      {(meta.forms.length ? meta.forms : [{ form_id: '', name: 'All forms (default)', status: '' }]).map((f) => { const m = d.mapping.find((x) => x.form_id === f.form_id)?.mapping ?? {}
        return <ActionForm key={f.form_id} action={saveMappingAction} submit="Save mapping" className="mt-3 space-y-2 border-t border-line pt-3"><input type="hidden" name="connection_id" value={meta.id} /><input type="hidden" name="form_id" value={f.form_id} /><p className="text-sm font-medium">{f.name}</p>
          <div className="grid gap-2 sm:grid-cols-3">{[...Object.entries(m), ['', ''], ['', '']].map(([q, to], i) => <div key={i} className="flex gap-1"><input name={`qname:${i}`} defaultValue={q} className="input" placeholder="meta question field" aria-label="Question" /><select name={`q:${q || '__new' + i}`} defaultValue={to} className="input w-40" aria-label="Maps to"><option value="">—</option>{['name', 'phone', 'email', 'city', 'state', 'country', 'student_name', 'grade', 'stream', 'school', 'language'].map((k) => <option key={k}>{k}</option>)}</select></div>)}</div></ActionForm> })}</section>}
  </Page>
}
