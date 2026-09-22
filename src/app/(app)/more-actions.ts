'use server'
// Server actions for Phases 2-6 screens. Each one validates, calls one app.* function or one policy-guarded statement,
// and maps failures to user messages. No SQL is built from input.
import { randomBytes } from 'node:crypto'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import { encrypt, newApiKey, sha256 } from '@/lib/crypto.ts'
import { userMessage } from '@/lib/errors.ts'
import { tenant } from '@/lib/session.ts'
import type { FormState } from './actions.ts'

const fields = (form: FormData) => Object.fromEntries([...form].filter(([k]) => !k.startsWith('$')))
const uuid = z.uuid()
async function run(path: string, okMsg: string, fn: () => Promise<unknown>): Promise<FormState> {
  try { await fn() } catch (e) { return { error: userMessage(e) } }
  revalidatePath(path, 'layout'); return { ok: okMsg }
}
export async function markReadAction(form: FormData) {
  const id = String(form.get('id') ?? '')
  await tenant((db) => id === 'all' ? db.query('update notifications set read_at = now() where read_at is null') : db.query('update notifications set read_at = now() where id = $1', [z.coerce.number().parse(id)]))
  revalidatePath('/', 'layout')
}
// ---- deals
export async function createDealAction(_: FormState, form: FormData): Promise<FormState> {
  const p = z.object({ lead_id: uuid, student_id: z.union([uuid, z.literal('')]).optional(), price_ids: z.array(uuid).optional(), expected_close: z.union([z.iso.date(), z.literal('')]).optional() }).safeParse({ ...fields(form), price_ids: form.getAll('price_ids') })
  if (!p.success) return { error: userMessage(new Error('INVALID')) }
  return run('/leads', 'Deal created.', () => tenant((db) => db.query('select app.create_deal($1,$2,$3,$4)', [p.data.lead_id, p.data.student_id || null, JSON.stringify((p.data.price_ids ?? []).map((id) => ({ price_id: id }))), p.data.expected_close || null])))
}
export async function moveDealAction(_: FormState, form: FormData): Promise<FormState> {
  const p = z.object({ deal_id: uuid, stage_id: uuid, lost_reason: z.string().max(200).optional(), note: z.string().max(2000).optional() }).safeParse(fields(form))
  if (!p.success) return { error: userMessage(new Error('INVALID')) }
  return run('/opportunities', 'Deal moved.', () => tenant((db) => db.query('select app.move_deal($1,$2,$3,$4)', [p.data.deal_id, p.data.stage_id, p.data.lost_reason || null, p.data.note || null])))
}
export async function paymentLinkAction(_: FormState, form: FormData): Promise<FormState> {
  const p = z.object({ deal_id: uuid }).safeParse(fields(form))
  if (!p.success) return { error: userMessage(new Error('INVALID')) }
  let link = ''
  const r = await run('/leads', '', () => tenant(async (db) => {
    const { rows: [x] } = await db.query<{ id: string }>('select app.request_payment($1) as id', [p.data.deal_id])
    const { rows: [d] } = await db.query<{ lead_id: string; centre: string | null; items: string[] }>("select d.lead_id, c.code as centre, coalesce(array_agg(i.description) filter (where i.id is not null), '{}') as items from deal_list d left join centres c on c.id = d.centre_id left join deal_items i on i.deal_id = d.id where d.id = $1 group by 1, 2", [p.data.deal_id])
    // PLACEHOLDER: the real checkout URL parameters depend on the elessons.net vendor (NEEDED.md)
    const base = process.env.CHECKOUT_BASE_URL ?? 'https://elessons.net/checkout'
    link = `${base}?${new URLSearchParams({ ref: d!.centre ?? 'HQ', lead: d!.lead_id, payment: x!.id, items: d!.items.join('|') })}`
  }))
  return r?.error ? r : { ok: `Payment link: ${link}` }
}
// ---- tasks (to-do board)
export async function completeTaskAction(form: FormData) {
  await tenant((db) => db.query('select app.complete_task($1)', [uuid.parse(form.get('task_id'))])); revalidatePath('/todos')
}
// ---- conversations
export async function sendMessageAction(_: FormState, form: FormData): Promise<FormState> {
  const p = z.object({ lead_id: uuid, connection_id: uuid, body: z.string().max(4000).optional(), template_id: z.union([uuid, z.literal('')]).optional(), vars: z.string().max(1000).optional() }).safeParse(fields(form))
  if (!p.success) return { error: userMessage(new Error('INVALID')) }
  if (!p.data.body?.trim() && !p.data.template_id) return { error: 'Type a message or pick a template.' }
  const vars = (p.data.vars ?? '').split('|').map((v) => v.trim()).filter(Boolean)
  return run('/conversations', 'Queued for sending.', () => tenant((db) => db.query('select app.queue_message($1,$2,$3,$4,$5)', [p.data.lead_id, p.data.connection_id, p.data.body?.trim() || null, p.data.template_id || null, JSON.stringify(vars)])))
}
export async function conversationAction(form: FormData) {
  const p = z.object({ id: uuid, status: z.enum(['open', 'awaiting', 'resolved']).optional(), starred: z.enum(['true', 'false']).optional(), owner: z.union([uuid, z.literal('')]).optional() }).parse(fields(form))
  await tenant((db) => db.query('update conversations set status = coalesce($2, status), starred = coalesce($3::boolean, starred), owner_user_id = case when $4::text is null then owner_user_id else nullif($4, \'\')::uuid end where id = $1',
    [p.id, p.status ?? null, p.starred ?? null, p.owner ?? null]))
  revalidatePath('/conversations')
}
// ---- catalogue
export async function catalogueItemAction(_: FormState, form: FormData): Promise<FormState> {
  const p = z.object({ name: z.string().trim().min(2).max(120), grade: z.coerce.number().int().min(8).max(12), plan: z.enum(['all_subjects', 'single_subject']), stream: z.enum(['', 'PCMB', 'PCMC', 'Commerce']), subject: z.string().max(60).optional(), mentorship: z.literal('on').optional(), website_params: z.string().max(500).optional() }).safeParse(fields(form))
  if (!p.success) return { error: p.error.issues[0]!.message }
  const d = p.data
  if (d.plan === 'single_subject' && !d.subject) return { error: 'Single-subject plans need a subject.' }
  return run('/catalogue', 'Item added.', () => tenant((db, c) => db.query('insert into catalogue_items (org_id, name, grade, plan, stream, subject, mentorship, website_params) values ($1,$2,$3,$4,$5,$6,$7,$8)',
    [c.org_id, d.name, d.grade, d.plan, d.stream || null, d.plan === 'single_subject' ? d.subject : null, !!d.mentorship, d.website_params ? Object.fromEntries(new URLSearchParams(d.website_params)) : {}])))
}
export async function priceAction(_: FormState, form: FormData): Promise<FormState> {
  const p = z.object({ item_id: uuid, currency: z.enum(['INR', 'AED', 'SAR', 'QAR', 'KWD', 'OMR', 'BHD']), region: z.string().trim().max(40).optional(), amount: z.coerce.number().min(0).max(10_000_000) }).safeParse(fields(form))
  if (!p.success) return { error: 'Check the currency and amount.' }
  return run('/catalogue', 'Price saved.', () => tenant((db) => db.query('insert into prices (item_id, currency, region, amount) values ($1,$2,$3,$4) on conflict (item_id, currency, region) do update set amount = excluded.amount, is_active = true', [p.data.item_id, p.data.currency, p.data.region ?? '', p.data.amount])))
}
export async function toggleActiveAction(form: FormData) {
  const p = z.object({ table: z.enum(['catalogue_items', 'prices', 'dispositions', 'deal_stages', 'automation_rules', 'distribution_rules', 'property_definitions']), id: uuid, active: z.enum(['true', 'false']) }).parse(fields(form))
  await tenant((db) => db.query(`update ${p.table} set is_active = $2 where id = $1`, [p.id, p.active === 'true']))     // table name from the enum above, never from input
  revalidatePath('/', 'layout')
}
// ---- lists
export async function createListAction(_: FormState, form: FormData): Promise<FormState> {
  const p = z.object({ name: z.string().trim().min(2).max(80), description: z.string().max(400).optional(), kind: z.enum(['static', 'dynamic']), filters: z.string().max(4000).optional(), scope: z.enum(['org', 'district', 'centre']) }).safeParse(fields(form))
  if (!p.success) return { error: p.error.issues[0]!.message }
  let filters: unknown = null
  if (p.data.kind === 'dynamic') { try { filters = JSON.parse(p.data.filters || '{}') } catch { return { error: 'Filters must be valid JSON (copy them from the Leads URL).' } } }
  return run('/lists', 'List created.', () => tenant((db) => db.query('select app.create_list($1,$2,$3,$4,$5)', [p.data.name, p.data.description || null, p.data.kind, filters ? JSON.stringify(filters) : null, p.data.scope])))
}
export async function listFlagsAction(form: FormData) {
  const p = z.object({ id: uuid, allow_duplicate: z.literal('on').optional(), disallow_auto_rechurn: z.literal('on').optional() }).parse(fields(form))
  await tenant((db) => db.query('update lists set allow_duplicate = $2, disallow_auto_rechurn = $3 where id = $1 and owner_user_id = app.uid()', [p.id, !!p.allow_duplicate, !!p.disallow_auto_rechurn]))
  revalidatePath('/lists')
}
// ---- integrations
export async function createConnectionAction(_: FormState, form: FormData): Promise<FormState> {
  const p = z.object({ kind: z.enum(['api', 'website', 'lms', 'payment', 'google_ads', 'whatsapp', 'outbound_webhook']), name: z.string().trim().min(2).max(80), centre_id: z.union([uuid, z.literal('')]).optional(),
    url: z.string().max(500).optional(), gateway: z.enum(['generic', 'razorpay', 'stripe']).optional(), phone_number_id: z.string().max(40).optional(), token: z.string().max(4000).optional() }).safeParse(fields(form))
  if (!p.success) return { error: p.error.issues[0]!.message }
  const d = p.data
  let shownOnce = ''
  const r = await run('/integrations', '', () => tenant(async (db) => {
    let secretEnc: string | null = null, keyHash: string | null = null, config: Record<string, unknown> = {}
    if (['api', 'website', 'lms', 'google_ads'].includes(d.kind)) { const key = newApiKey(); keyHash = sha256(key); shownOnce = key }
    if (d.kind === 'payment') { const secret = randomBytes(24).toString('base64url'); secretEnc = encrypt(secret); shownOnce = secret; config = { gateway: d.gateway ?? 'generic' } }
    if (d.kind === 'outbound_webhook') { if (!/^https:\/\//.test(d.url ?? '')) throw new Error('INVALID'); const secret = randomBytes(24).toString('base64url'); secretEnc = encrypt(secret); shownOnce = secret; config = { url: d.url } }
    if (d.kind === 'whatsapp') { if (!d.token || !d.phone_number_id) throw new Error('INVALID'); secretEnc = encrypt(d.token); config = { phone_number_id: d.phone_number_id } }
    const { rows: [c] } = await db.query<{ id: string }>('select app.create_connection($1,$2,$3,$4,$5,$6) as id', [d.kind, d.name, d.centre_id || null, secretEnc, keyHash, JSON.stringify(config)])
    if (d.kind === 'whatsapp') await db.query("update connections set external_id = $2 where id = $1", [c!.id, d.phone_number_id]).catch(() => db.query('select app.update_connection($1, $2)', [c!.id, JSON.stringify({ config: { phone_number_id: d.phone_number_id } })]))
  }))
  if (r?.error) return r
  return { ok: shownOnce ? `Connected. Copy this now — it is shown once: ${shownOnce}` : 'Connected.' }
}
export async function connectionPatchAction(form: FormData) {
  const p = z.object({ id: uuid, status: z.enum(['connected', 'disabled']).optional(), pixel_id: z.string().max(40).optional(), ad_account_id: z.string().max(40).optional() }).parse(fields(form))
  const patch: Record<string, unknown> = {}; if (p.status) patch.status = p.status
  const config: Record<string, string> = {}; if (p.pixel_id !== undefined) config.pixel_id = p.pixel_id; if (p.ad_account_id !== undefined) config.ad_account_id = p.ad_account_id.replace(/^act_/, '')
  if (Object.keys(config).length) patch.config = config
  await tenant((db) => db.query('select app.update_connection($1, $2)', [p.id, JSON.stringify(patch)]))
  revalidatePath('/integrations')
}
export async function saveMappingAction(_: FormState, form: FormData): Promise<FormState> {
  const { connection_id, form_id, ...rest } = fields(form) as Record<string, string>
  // pairs: qname:<i> = the Meta question field, q:<key or __new<i>> = the lead field it maps to
  const names = Object.fromEntries(Object.entries(rest).filter(([k]) => k.startsWith('qname:')).map(([k, v]) => [k.slice(6), v.trim().toLowerCase()]))
  const mapping: Record<string, string> = {}
  for (const [k, v] of Object.entries(rest)) { if (!k.startsWith('q:') || !v) continue; const key = k.slice(2); const q = key.startsWith('__new') ? names[key.slice(5)] : key; if (q) mapping[q] = v }
  return run('/integrations', 'Mapping saved.', () => tenant((db) => db.query('select app.save_mapping($1,$2,$3)', [uuid.parse(connection_id), form_id ?? '', JSON.stringify(mapping)])))
}
export async function syncFormsAction(form: FormData) {
  const id = uuid.parse(form.get('connection_id'))
  const { listForms, subscribePage } = await import('@/lib/meta.ts'); const { decrypt } = await import('@/lib/crypto.ts')
  await tenant(async (db) => {
    const { rows: [c] } = await db.query<{ external_id: string; secret_enc: string }>('select external_id, app.connection_secret($1) as secret_enc from connections where id = $1', [id])
    if (!c?.secret_enc) throw new Error('PERMISSION_DENIED')
    const token = decrypt(c.secret_enc)
    try {
      await subscribePage(fetch, c.external_id, token)
      const forms = await listForms(fetch, c.external_id, token)
      await db.query('select app.save_forms($1, $2)', [id, JSON.stringify(forms)])
      await db.query('select app.connection_result($1, null)', [id])
    } catch (e) { await db.query('select app.connection_result($1, $2)', [id, String(e)]); throw e }
  }).catch(() => {})
  revalidatePath('/integrations')
}
// ---- routing
export async function routingRuleAction(_: FormState, form: FormData): Promise<FormState> {
  const p = z.object({ name: z.string().trim().min(2).max(80), priority: z.coerce.number().int().min(1).max(1000), field: z.enum(['', 'country', 'state', 'city', 'grade', 'source', 'page', 'campaign', 'form', 'language']), op: z.enum(['eq', 'neq', 'in']), value: z.string().max(200).optional(),
    method: z.enum(['round_robin_centres', 'round_robin_users']), centre_ids: z.array(uuid).optional(), user_ids: z.array(uuid).optional() }).safeParse({ ...fields(form), centre_ids: form.getAll('centre_ids'), user_ids: form.getAll('user_ids') })
  if (!p.success) return { error: p.error.issues[0]!.message }
  const d = p.data
  const conditions = d.field ? [{ field: d.field, op: d.op, value: d.op === 'in' ? (d.value ?? '').split(',').map((v) => v.trim()).filter(Boolean) : d.value }] : []
  return run('/admin/routing', 'Rule saved.', () => tenant((db, c) => db.query('insert into distribution_rules (org_id, name, priority, conditions, method, target_centre_ids, target_user_ids, created_by) values ($1,$2,$3,$4,$5,$6,$7,$8)',
    [c.org_id, d.name, d.priority, JSON.stringify(conditions), d.method, d.centre_ids ?? [], d.user_ids ?? [], c.user_id])))
}
export async function routePreviewAction(_: FormState, form: FormData): Promise<FormState> {
  const p = z.object({ state: z.string().max(80).optional(), city: z.string().max(80).optional(), country: z.string().max(2).optional(), grade: z.string().max(2).optional(), source: z.string().max(80).optional() }).safeParse(fields(form))
  if (!p.success) return { error: userMessage(new Error('INVALID')) }
  try {
    const r = await tenant(async (db) => (await db.query<{ r: { rule: string | null; centre_id: string | null; owner_user_id: string | null } }>('select app.route_preview($1) as r', [JSON.stringify({ ...p.data, source: { l1: p.data.source }, students: [{ grade: p.data.grade }] })])).rows[0]!.r)
    const { rows: [where] } = await tenant((db) => db.query<{ c: string | null; u: string | null }>('select (select code from centres where id = $1) as c, (select display_name from users where id = $2) as u', [r.centre_id, r.owner_user_id]))
    return { ok: r.rule ? `Rule “${r.rule}” → ${where?.c ?? 'HQ pool'}${where?.u ? ` · ${where.u}` : ''}` : 'No rule matches: this lead would wait in the HQ pool, unassigned.' }
  } catch (e) { return { error: userMessage(e) } }
}
export async function fallbackAction(form: FormData) {
  const p = z.object({ fallback_owner_id: z.union([uuid, z.literal('')]) }).parse(fields(form))
  await tenant((db) => db.query('update orgs set fallback_owner_id = nullif($1, \'\')::uuid, fallback_centre_id = (select centre_id from users where id = nullif($1, \'\')::uuid) where id = app.org_id() and app.has_perm(\'routing.manage\')', [p.fallback_owner_id]))
  revalidatePath('/admin/routing')
}
// ---- config
export async function leadConfigAction(_: FormState, form: FormData): Promise<FormState> {
  const p = z.object({ cadence_days: z.string().regex(/^\d+(\s*,\s*\d+)*$/, 'Cadence: comma-separated day numbers'), calling_start: z.string().regex(/^\d\d:\d\d$/), calling_end: z.string().regex(/^\d\d:\d\d$/), working_days: z.array(z.coerce.number().int().min(1).max(7)),
    sla_first_touch_minutes: z.coerce.number().int().min(1).max(1440), sla_untouched_hours: z.coerce.number().int().min(1).max(720), cross_centre_policy: z.enum(['first_touch_wins', 'hq_decides']), referral_window_days: z.coerce.number().int().min(1).max(365), renewal_lead_days: z.coerce.number().int().min(1).max(365) })
    .safeParse({ ...fields(form), working_days: form.getAll('working_days') })
  if (!p.success) return { error: p.error.issues[0]!.message }
  const d = { ...p.data, cadence_days: p.data.cadence_days.split(',').map((x) => Number(x.trim())) }
  return run('/admin/config', 'Settings saved.', () => tenant((db) => db.query('select app.update_lead_config($1)', [JSON.stringify(d)])))
}
export async function dispositionAction(_: FormState, form: FormData): Promise<FormState> {
  const p = z.object({ id: z.union([uuid, z.literal('')]).optional(), name: z.string().trim().min(2).max(60), sentiment: z.enum(['positive', 'neutral', 'negative', 'junk']), effect: z.enum(['none', 'to_interested', 'to_dead', 'to_enrolled']),
    followup: z.enum(['none', 'cadence', 'days', 'user']), followup_days: z.coerce.number().int().min(1).max(365).optional(), note_required: z.literal('on').optional(), creates_deal: z.literal('on').optional(), add_tag: z.string().max(40).optional(), sort: z.coerce.number().int().default(50) }).safeParse(fields(form))
  if (!p.success) return { error: p.error.issues[0]!.message }
  const d = p.data
  return run('/admin/config', 'Disposition saved.', () => tenant((db, c) => d.id
    ? db.query('update dispositions set name=$2, sentiment=$3, effect=$4, followup=$5, followup_days=$6, note_required=$7, creates_deal=$8, add_tag=$9, sort=$10 where id=$1', [d.id, d.name, d.sentiment, d.effect, d.followup, d.followup === 'days' ? d.followup_days ?? 2 : null, !!d.note_required, !!d.creates_deal, d.add_tag || null, d.sort])
    : db.query('insert into dispositions (org_id, name, sentiment, effect, followup, followup_days, note_required, creates_deal, add_tag, sort) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)', [c.org_id, d.name, d.sentiment, d.effect, d.followup, d.followup === 'days' ? d.followup_days ?? 2 : null, !!d.note_required, !!d.creates_deal, d.add_tag || null, d.sort])))
}
export async function lifecycleLabelAction(form: FormData) {
  const p = z.object({ state: z.enum(['ENQUIRY', 'PROSPECT', 'INTERESTED', 'DEAD', 'ENROLLED']), label: z.string().trim().min(1).max(30) }).parse(fields(form))
  await tenant((db, c) => db.query('insert into lifecycle_labels (org_id, state, label) values ($1,$2,$3) on conflict (org_id, state) do update set label = excluded.label', [c.org_id, p.state, p.label]))
  revalidatePath('/', 'layout')
}
export async function dealStageAction(_: FormState, form: FormData): Promise<FormState> {
  const p = z.object({ name: z.string().trim().min(2).max(60), sort: z.coerce.number().int(), is_won: z.literal('on').optional(), is_lost: z.literal('on').optional() }).safeParse(fields(form))
  if (!p.success) return { error: p.error.issues[0]!.message }
  return run('/admin/config', 'Stage added.', () => tenant((db, c) => db.query('insert into deal_stages (org_id, name, sort, is_won, is_lost) values ($1,$2,$3,$4,$5)', [c.org_id, p.data.name, p.data.sort, !!p.data.is_won, !!p.data.is_lost])))
}
export async function permissionToggleAction(form: FormData) {
  const p = z.object({ role: z.enum(['HQ_ADMIN', 'HQ_COUNSELLOR', 'DISTRICT_MANAGER', 'CENTRE_ADMIN', 'COUNSELLOR']), key: z.string().max(60), allowed: z.enum(['true', 'false']) }).parse(fields(form))
  await tenant((db, c) => db.query('insert into role_permissions (org_id, role, permission_key, allowed) values ($1,$2,$3,$4) on conflict (org_id, role, permission_key) do update set allowed = excluded.allowed', [c.org_id, p.role, p.key, p.allowed === 'true']))
  revalidatePath('/admin/permissions')
}
export async function centreSettingsAction(form: FormData) {
  const p = z.object({ centre_id: uuid, counsellor_lead_visibility: z.enum(['own', 'all']), intra_centre_assignment: z.enum(['centre_admin', 'round_robin']), accepts_inbound: z.literal('on').optional() }).parse(fields(form))
  await tenant((db) => db.query('update centres set counsellor_lead_visibility = $2, intra_centre_assignment = $3, accepts_inbound = $4, updated_at = now() where id = $1', [p.centre_id, p.counsellor_lead_visibility, p.intra_centre_assignment, !!p.accepts_inbound]))
  revalidatePath('/admin/centres')
}
export async function couponAction(form: FormData) {
  const p = z.object({ centre_id: uuid, coupon: z.string().max(30) }).parse(fields(form))
  await tenant((db) => db.query('select app.set_coupon($1, $2)', [p.centre_id, p.coupon])); revalidatePath('/admin/centres')
}
// ---- automation
export async function automationRuleAction(_: FormState, form: FormData): Promise<FormState> {
  const p = z.object({ name: z.string().trim().min(2).max(80), trigger: z.string().max(40), conditions: z.string().max(4000).optional(), actions: z.string().max(8000), quiet_hours: z.literal('on').optional(), rate_limit: z.coerce.number().int().min(1).max(100).default(3), scope: z.enum(['org', 'district', 'centre']) }).safeParse(fields(form))
  if (!p.success) return { error: p.error.issues[0]!.message }
  let conditions: unknown, actions: unknown
  try { conditions = JSON.parse(p.data.conditions || '[]'); actions = JSON.parse(p.data.actions) } catch { return { error: 'Conditions and actions must be valid JSON arrays.' } }
  if (!Array.isArray(actions) || !actions.length) return { error: 'Add at least one action.' }
  return run('/admin/automation', 'Rule saved.', () => tenant((db, c) => db.query('insert into automation_rules (org_id, district_id, centre_id, name, trigger, conditions, actions, quiet_hours, rate_limit_per_lead_per_day, created_by) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
    [c.org_id, p.data.scope === 'district' ? c.district_id : p.data.scope === 'centre' ? c.district_id : null, p.data.scope === 'centre' ? c.centre_id : null, p.data.name, p.data.trigger, JSON.stringify(conditions), JSON.stringify(actions), !!p.data.quiet_hours, p.data.rate_limit, c.user_id])))
}
// ---- templates / broadcasts
export async function templateAction(_: FormState, form: FormData): Promise<FormState> {
  const p = z.object({ name: z.string().trim().regex(/^[a-z0-9_]{2,60}$/, 'Template name: lowercase, digits, underscores'), language: z.string().max(8).default('en'), category: z.enum(['MARKETING', 'UTILITY', 'AUTHENTICATION']), body: z.string().trim().min(1).max(1024), connection_id: z.union([uuid, z.literal('')]).optional(), status: z.enum(['draft', 'submitted', 'approved', 'rejected', 'paused']).default('draft'), external_id: z.string().max(60).optional() }).safeParse(fields(form))
  if (!p.success) return { error: p.error.issues[0]!.message }
  const vars = [...new Set(p.data.body.match(/\{\{\d+\}\}/g) ?? [])]
  return run('/admin/templates', 'Template saved.', () => tenant((db, c) => db.query('insert into templates (org_id, connection_id, name, language, category, body, variables, status, external_id, created_by) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) on conflict (org_id, name, language) do update set body = excluded.body, category = excluded.category, status = excluded.status, external_id = excluded.external_id, updated_at = now()',
    [c.org_id, p.data.connection_id || null, p.data.name, p.data.language, p.data.category, p.data.body, vars, p.data.status, p.data.external_id || null, c.user_id])))
}
export async function broadcastAction(_: FormState, form: FormData): Promise<FormState> {
  const p = z.object({ name: z.string().trim().min(2).max(80), objective: z.string().max(200).optional(), list_id: uuid, template_id: uuid, connection_id: uuid, recipient_limit: z.union([z.coerce.number().int().min(1), z.literal('')]).optional(), mode: z.enum(['existing', 'existing_and_new', 'new_only']), scheduled_at: z.string().max(20).optional() }).safeParse(fields(form))
  if (!p.success) return { error: p.error.issues[0]!.message }
  const d = p.data
  return run('/admin/broadcasts', 'Broadcast submitted.', () => tenant((db) => db.query('select app.create_broadcast($1,$2,$3,$4,$5,$6,$7,$8)', [d.name, d.objective || null, d.list_id, d.template_id, d.connection_id, d.recipient_limit || null, d.mode, d.scheduled_at ? new Date(d.scheduled_at) : null])))
}
export async function broadcastStatusAction(form: FormData) {
  const p = z.object({ id: uuid, status: z.enum(['paused', 'running']) }).parse(fields(form))
  await tenant((db) => db.query('select app.set_broadcast_status($1, $2)', [p.id, p.status])); revalidatePath('/admin/broadcasts')
}
// ---- payouts / properties / merge / custom values
export async function payoutRuleAction(_: FormState, form: FormData): Promise<FormState> {
  const p = z.object({ centre_id: z.union([uuid, z.literal('')]).optional(), kind: z.enum(['percent', 'fixed']), rate: z.coerce.number().min(0).max(100000), currency: z.string().max(3).optional(), valid_from: z.iso.date() }).safeParse(fields(form))
  if (!p.success) return { error: 'Check the rate and date.' }
  return run('/admin/payouts', 'Payout rule saved.', () => tenant((db, c) => db.query('insert into payout_rules (org_id, centre_id, kind, rate, currency, valid_from, created_by) values ($1,$2,$3,$4,$5,$6,$7)', [c.org_id, p.data.centre_id || null, p.data.kind, p.data.rate, p.data.currency || null, p.data.valid_from, c.user_id])))
}
export async function propertyAction(_: FormState, form: FormData): Promise<FormState> {
  const p = z.object({ entity: z.enum(['lead', 'student', 'deal', 'user', 'payment']), key: z.string().regex(/^[a-z][a-z0-9_]{1,39}$/, 'Key: lowercase letters, digits, underscores'), label: z.string().trim().min(1).max(60), type: z.enum(['text', 'number', 'date', 'option', 'multi_option', 'phone']), options: z.string().max(1000).optional(), parent_key: z.string().max(40).optional() }).safeParse(fields(form))
  if (!p.success) return { error: p.error.issues[0]!.message }
  const d = p.data
  return run('/admin/properties', 'Property added.', () => tenant((db, c) => db.query('insert into property_definitions (org_id, entity, key, label, type, options, parent_key) values ($1,$2,$3,$4,$5,$6,$7)', [c.org_id, d.entity, d.key, d.label, d.type, (d.options ?? '').split(',').map((o) => o.trim()).filter(Boolean), d.parent_key || null])))
}
export async function customValuesAction(_: FormState, form: FormData): Promise<FormState> {
  const { lead_id, ...rest } = fields(form) as Record<string, string>
  return run('/leads', 'Properties saved.', () => tenant((db) => db.query('select app.set_custom($1, $2)', [uuid.parse(lead_id), JSON.stringify(Object.fromEntries(Object.entries(rest).filter(([k]) => k.startsWith('cp:')).map(([k, v]) => [k.slice(3), v])))])))
}
export async function mergeAction(_: FormState, form: FormData): Promise<FormState> {
  const p = z.object({ winner_id: uuid, loser_id: uuid }).safeParse(fields(form))
  if (!p.success) return { error: 'Pick the lead to merge into this one.' }
  const r = await run('/leads', 'Leads merged.', () => tenant((db) => db.query('select app.merge_leads($1, $2)', [p.data.winner_id, p.data.loser_id])))
  if (r?.ok) redirect(`/leads?lead=${p.data.winner_id}`)
  return r
}
// ---- Salesmax migration
export async function salesmaxUploadAction(_: FormState, form: FormData): Promise<FormState> {
  const { parseCsv } = await import('@/lib/csv.ts')
  const file = form.get('file')
  if (!(file instanceof File) || !file.size) return { error: 'Choose the Salesmax export file (CSV or XLSX).' }
  if (file.size > 50 * 1024 * 1024) return { error: 'File is larger than 50 MB. Split the export.' }
  let table: string[][]
  try {
    if (/\.xlsx$/i.test(file.name)) { const { readSheet } = await import('read-excel-file/node'); table = (await readSheet(Buffer.from(await file.arrayBuffer()))).map((r) => r.map((c) => (c == null ? '' : String(c)))) }
    else table = parseCsv(await file.text())
  } catch { return { error: "That file couldn't be read." } }
  const [headers, ...body] = table.filter((r) => r.some((c) => c.trim()))
  if (!headers || !body.length) return { error: 'The file has no data rows.' }
  const rows = body.map((r) => Object.fromEntries(headers.map((h, i) => [h.trim(), r[i] ?? ''])))
  let id = ''
  const r = await run('/admin/migration', '', () => tenant(async (db) => { id = (await db.query<{ id: string }>("select app.create_import_batch(null, $1, $2, $3, 'salesmax') as id", [file.name.slice(0, 120), headers.map((h) => h.trim()), JSON.stringify(rows)])).rows[0]!.id }))
  if (r?.error) return r
  redirect(`/admin/migration?batch=${id}`)
}
export async function salesmaxStartAction(_: FormState, form: FormData): Promise<FormState> {
  const { batch_id, ...mapping } = fields(form) as Record<string, string>
  if (!mapping.phone) return { error: 'Map the phone column.' }
  return run('/admin/migration', 'Import started. Reconciliation updates as rows are processed.', () => tenant((db) => db.query('select app.start_import($1,$2)', [uuid.parse(batch_id), JSON.stringify(mapping)])))
}
