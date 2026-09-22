'use server'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import { parseCsv } from '@/lib/csv.ts'
import { userMessage } from '@/lib/errors.ts'
import { normaliseLead, normalisePhone } from '@/lib/ingest/normalize.ts'
import { leadFilterSchema } from '@/lib/leads-query.ts'
import { tenant } from '@/lib/session.ts'
import type { FormState } from '../actions.ts'

const fields = (form: FormData) => Object.fromEntries([...form].filter(([k]) => !k.startsWith('$')))
async function run(okMsg: string, fn: () => Promise<unknown>, path = '/leads'): Promise<FormState> {
  try { await fn() } catch (e) { return { error: userMessage(e) } }
  revalidatePath(path)
  return { ok: okMsg }
}

const newLead = z.object({
  phone: z.string().min(4).max(30), name: z.string().trim().max(120).optional(), email: z.string().trim().max(200).optional(),
  city: z.string().trim().max(80).optional(), state: z.string().trim().max(80).optional(),
  student_name: z.string().trim().max(120).optional(), grade: z.enum(['', '8', '9', '10', '11', '12']).optional(),
  stream: z.enum(['', 'PCMB', 'PCMC', 'Commerce']).optional(), school: z.string().trim().max(160).optional(),
  how: z.enum(['Walk-in', 'Phone call', 'Reference', 'Event', 'Other']), consent: z.literal('on').optional(),
  centre_id: z.union([z.uuid(), z.literal('')]).optional(), idempotency_key: z.uuid(),
})
// Manual entry goes through the same gate as every other source: store raw -> normalise -> app.ingest_lead.
export async function addLeadAction(_: FormState, form: FormData): Promise<FormState> {
  const p = newLead.safeParse(fields(form))
  if (!p.success) return { error: userMessage(new Error('INVALID')) }
  const d = p.data
  let target: string
  try {
    target = await tenant(async (db, c) => {
      const centre = c.centre_id ?? (d.centre_id || null)
      const { rows: [ctx] } = await db.query<{ country: string; tz: string }>(
        `select coalesce((select default_country from centres where id = $1), 'IN') as country,
                coalesce((select timezone from centres where id = $1), 'Asia/Kolkata') as tz`, [centre])
      const raw = { ...d, source: { l1: 'Manual', l2: d.how }, consent: { status: d.consent ? 'granted' : 'unknown', source: 'manual_entry', evidence: { captured_by: c.user_id } } }
      const lead = normaliseLead(raw, ctx!.country, ctx!.tz)
      if (!lead) throw new Error('INVALID_PHONE')
      const { rows: [e] } = await db.query<{ id: string }>('select app.receive_event($1,$2,$3,$4) as id', ['manual', centre, `manual:${d.idempotency_key}`, JSON.stringify(raw)])
      const { rows: [r] } = await db.query<{ r: { outcome: string; lead_id: string | null } }>('select app.ingest_lead($1,$2) as r', [e!.id, JSON.stringify(lead)])
      if (r!.r.outcome === 'dnc') throw new Error('DNC')
      return `/leads?lead=${r!.r.lead_id}${r!.r.outcome === 'duplicate' ? '&existing=1' : ''}`
    })
  } catch (e) { return { error: userMessage(e) } }
  revalidatePath('/leads')
  redirect(target)
}

export async function checkPhoneAction(phone: string, country: string): Promise<string | null> {
  return normalisePhone(phone, /^[A-Z]{2}$/.test(country) ? country : 'IN')?.e164 ?? null
}

const outcome = z.object({ lead_id: z.uuid(), disposition_id: z.uuid(), note: z.string().max(4000).optional(), followup: z.union([z.literal(''), z.string().regex(/^\d{4}-\d\d-\d\dT\d\d:\d\d$/)]).optional() })
export async function callOutcomeAction(_: FormState, form: FormData): Promise<FormState> {
  const p = outcome.safeParse(fields(form))
  if (!p.success) return { error: 'Choose an outcome.' }
  // TE-5: the time typed is wall-clock time where the PARENT is, not where the counsellor or the server is
  return run('Outcome saved.', () => tenant((db) => db.query(
    `select app.apply_disposition($1, $2, $3, $4::timestamp at time zone (select timezone from lead_list where id = $1))`,
    [p.data.lead_id, p.data.disposition_id, p.data.note || null, p.data.followup || null])))
}

export async function noteAction(_: FormState, form: FormData): Promise<FormState> {
  const p = z.object({ lead_id: z.uuid(), note: z.string().trim().min(1, 'Write a note first.').max(4000) }).safeParse(fields(form))
  if (!p.success) return { error: p.error.issues[0]!.message }
  return run('Note added.', () => tenant((db) => db.query('select app.add_note($1,$2)', [p.data.lead_id, p.data.note])))
}

const task = z.object({ lead_id: z.uuid(), type: z.enum(['followup', 'call', 'whatsapp', 'send_demo', 'payment_followup', 'custom']), title: z.string().trim().min(2).max(160), due: z.string().regex(/^\d{4}-\d\d-\d\dT\d\d:\d\d$/, 'Pick a due date and time.') })
export async function taskAction(_: FormState, form: FormData): Promise<FormState> {
  const p = task.safeParse(fields(form))
  if (!p.success) return { error: p.error.issues[0]!.message }
  return run('Task created.', () => tenant((db) => db.query(
    'select app.create_task($1,$2,$3,$4::timestamp at time zone (select timezone from lead_list where id = $1))', [p.data.lead_id, p.data.type, p.data.title, p.data.due])))
}
export async function completeTaskAction(form: FormData) {
  await tenant((db) => db.query('select app.complete_task($1)', [z.uuid().parse(form.get('task_id'))]))
  revalidatePath('/leads')
}

const student = z.object({ lead_id: z.uuid(), name: z.string().trim().min(1).max(120), grade: z.coerce.number().int().min(8).max(12), stream: z.enum(['', 'PCMB', 'PCMC', 'Commerce']), school: z.string().max(160).optional(), board: z.string().max(40).optional() })
export async function studentAction(_: FormState, form: FormData): Promise<FormState> {
  const p = student.safeParse(fields(form))
  if (!p.success) return { error: 'Student needs a name and a grade from 8 to 12.' }
  if (p.data.stream && p.data.grade < 11) return { error: 'Streams apply to Grades 11 and 12 only.' }
  return run('Student added.', () => tenant((db) => db.query('select app.add_student($1,$2,$3,$4,$5,$6)', [p.data.lead_id, p.data.name, p.data.grade, p.data.stream, p.data.school ?? null, p.data.board ?? null])))
}

export async function contactAction(_: FormState, form: FormData): Promise<FormState> {
  const p = z.object({ lead_id: z.uuid(), name: z.string().max(120), email: z.union([z.literal(''), z.email()]), state: z.string().max(80), city: z.string().max(80), language: z.string().max(40) }).safeParse(fields(form))
  if (!p.success) return { error: 'Check the email address.' }
  return run('Contact updated.', () => tenant((db) => db.query('select app.update_lead_contact($1,$2,$3,$4,$5,$6)', [p.data.lead_id, p.data.name, p.data.email, p.data.state, p.data.city, p.data.language])))
}

export async function repeatEnquiryAction(_: FormState, form: FormData): Promise<FormState> {
  const id = z.uuid().safeParse(form.get('lead_id'))
  if (!id.success) return { error: userMessage(new Error('INVALID')) }
  return run('Reopened as a new enquiry.', () => tenant((db) => db.query('select app.repeat_enquiry($1)', [id.data])))
}

export async function eraseAction(_: FormState, form: FormData): Promise<FormState> {
  const p = z.object({ lead_id: z.uuid(), reason: z.string().trim().min(3, 'Give a reason.') }).safeParse(fields(form))
  if (!p.success) return { error: p.error.issues[0]!.message }
  const r = await run('Lead erased.', () => tenant((db) => db.query('select app.anonymise_lead($1,$2)', [p.data.lead_id, p.data.reason])))
  if (r?.ok) redirect('/leads')
  return r
}

const bulk = z.object({ op: z.enum(['assign', 'transfer', 'tag', 'list', 'export', 'pull_back']), owner: z.string().optional(), centre: z.string().optional(), reason: z.string().optional(), tag: z.string().optional(), list: z.string().optional(), filters: z.string().optional() })
export async function bulkAction(_: FormState, form: FormData): Promise<FormState> {
  const ids = z.array(z.uuid()).max(5000).safeParse(form.getAll('ids'))
  const p = bulk.safeParse(fields(form))
  if (!p.success || !ids.success) return { error: userMessage(new Error('INVALID')) }
  const d = p.data, n = ids.data.length
  if (d.op !== 'export' && !n) return { error: 'Select at least one lead first.' }
  try {
    return await tenant(async (db) => {
      switch (d.op) {
        case 'assign': { const r = await db.query<{ n: number }>('select app.assign_leads($1,$2) as n', [ids.data, z.uuid().parse(d.owner)]); return { ok: `${r.rows[0]!.n} lead(s) assigned.` } }
        case 'transfer': {
          const r = await db.query<{ r: { transferred: number; skipped_duplicate_in_target: string[] } }>('select app.transfer_leads($1,$2,$3) as r', [ids.data, z.uuid().parse(d.centre), d.reason ?? ''])
          const s = r.rows[0]!.r.skipped_duplicate_in_target.length
          return { ok: `${r.rows[0]!.r.transferred} transferred.${s ? ` ${s} skipped: the target centre already has a lead for that parent.` : ''}` }
        }
        case 'pull_back': { const r = await db.query<{ n: number }>('select app.pull_back_leads($1,$2) as n', [ids.data, d.reason ?? '']); return { ok: `${r.rows[0]!.n} lead(s) pulled back to the HQ pool.` } }
        case 'tag': { const r = await db.query<{ n: number }>('select app.tag_leads($1,$2) as n', [ids.data, d.tag ?? '']); return { ok: `Tag added to ${r.rows[0]!.n} lead(s).` } }
        case 'list': { const r = await db.query<{ n: number }>('select app.add_to_list($1,$2) as n', [ids.data, z.uuid().parse(d.list)]); return { ok: `${r.rows[0]!.n} added to the list.` } }
        case 'export': {
          const filters = leadFilterSchema.parse({ ...JSON.parse(d.filters || '{}'), cursor: undefined, ids: n ? ids.data : undefined })
          await db.query('select app.request_export($1)', [JSON.stringify(filters)])
          return { ok: 'Export queued. It will appear under Exports when ready.' }
        }
      }
    }).finally(() => revalidatePath('/leads'))
  } catch (e) { return { error: e instanceof z.ZodError ? 'Choose a target for this action.' : userMessage(e) } }
}

// ---- import (LT-6)
export async function uploadImportAction(_: FormState, form: FormData): Promise<FormState> {
  const file = form.get('file')
  if (!(file instanceof File) || !file.size) return { error: 'Choose a CSV or XLSX file.' }
  if (file.size > 10 * 1024 * 1024) return { error: 'File is larger than 10 MB. Split it and upload in parts.' }
  let table: string[][]
  try {
    if (/\.xlsx$/i.test(file.name)) {
      const { readSheet } = await import('read-excel-file/node')     // first sheet
      table = (await readSheet(Buffer.from(await file.arrayBuffer()))).map((r) => r.map((c) => (c == null ? '' : String(c))))
    } else table = parseCsv(await file.text())
  } catch { return { error: "That file couldn't be read. Save it as CSV or XLSX and try again." } }
  const [headers, ...body] = table.filter((r) => r.some((c) => c.trim()))
  if (!headers || !body.length) return { error: 'The file has no data rows.' }
  if (body.length > 20000) return { error: 'Maximum 20,000 rows per upload.' }
  const rows = body.map((r) => Object.fromEntries(headers.map((h, i) => [h.trim(), r[i] ?? ''])))
  let id: string
  try {
    id = await tenant(async (db) => (await db.query<{ id: string }>('select app.create_import_batch($1,$2,$3,$4) as id',
      [z.uuid().nullable().catch(null).parse(form.get('centre_id') || null), file.name.slice(0, 120), headers.map((h) => h.trim()), JSON.stringify(rows)])).rows[0]!.id)
  } catch (e) { return { error: userMessage(e) } }
  redirect(`/leads/import/${id}`)
}

export async function startImportAction(_: FormState, form: FormData): Promise<FormState> {
  const { batch_id, ...mapping } = fields(form) as Record<string, string>
  if (!mapping.phone) return { error: 'Map a column to Phone. Every lead needs a phone number.' }
  return run('Import started.', () => tenant((db) => db.query('select app.start_import($1,$2)', [z.uuid().parse(batch_id), JSON.stringify(mapping)])), `/leads/import/${batch_id}`)
}

// ---- HQ operations
export async function replayEventAction(form: FormData) {
  await tenant((db) => db.query('select app.replay_event($1)', [z.uuid().parse(form.get('event_id'))]))
  revalidatePath('/admin/inbound')
}
export async function resolveConflictAction(form: FormData) {
  const p = z.object({ conflict_id: z.uuid(), resolution: z.enum(['keep_first', 'move_to_second', 'share_credit']) }).parse(fields(form))
  await tenant((db) => db.query('select app.resolve_conflict($1,$2)', [p.conflict_id, p.resolution]))
  revalidatePath('/admin/conflicts')
}
export async function dncAddAction(_: FormState, form: FormData): Promise<FormState> {
  const e164 = normalisePhone(String(form.get('phone') ?? ''), 'IN')?.e164
  if (!e164) return { error: userMessage(new Error('INVALID_PHONE')) }
  return run('Number added to Do Not Contact.', () => tenant((db) => db.query('select app.dnc_add($1,$2)', [e164, String(form.get('reason') ?? '')])), '/admin/dnc')
}
