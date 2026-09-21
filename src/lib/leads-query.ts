// One filter -> SQL builder shared by the lead list, report drill-downs, dynamic lists and the export worker,
// so "the number on the report", "the list behind it" and "the export" are the same query.
// SECURITY: every value is a bound parameter; every identifier comes from a whitelist below. Never interpolate input.
import { z } from 'zod'

const ACTIVE = "v.lifecycle in ('ENQUIRY','PROSPECT','INTERESTED')"
export const SMART_VIEWS = {
  active: { label: 'All Active', where: ACTIVE },
  enquiry: { label: 'Enquiry', where: "v.lifecycle = 'ENQUIRY'" },
  assigned_today: { label: 'Assigned Today', where: `v.assigned_at >= date_trunc('day', now()) and ${ACTIVE}` },
  never_picked: { label: 'Never Picked', where: "v.attempts = 0 and v.lifecycle = 'ENQUIRY'" },
  prospect: { label: 'Prospect', where: "v.lifecycle = 'PROSPECT'" },
  interested: { label: 'Interested', where: "v.lifecycle = 'INTERESTED'" },
  customer: { label: 'Is Customer', where: 'v.is_customer' },
  due: { label: 'Follow-up Due', where: "v.next_followup_at < date_trunc('day', now()) + interval '1 day' and v.next_followup_at >= date_trunc('day', now())" },
  overdue: { label: 'Overdue', where: `v.next_followup_at < now() and ${ACTIVE}` },
  unassigned: { label: 'Unassigned', where: `v.owner_user_id is null and ${ACTIVE}` },
  worked: { label: 'Worked Leads', where: "v.lifecycle in ('DEAD','ENROLLED')" },
  all: { label: 'All', where: 'true' },           // report drill-downs
} as const
export type SmartView = keyof typeof SMART_VIEWS

// ---- query builder (WS-4): AND/OR groups over whitelisted fields
type FieldDef = { sql: string; kind: 'text' | 'num' | 'date' | 'bool' | 'tags' | 'uuid'; label: string; student?: boolean }
export const QB_FIELDS: Record<string, FieldDef> = {
  name: { sql: 'v.name', kind: 'text', label: 'Parent name' }, city: { sql: 'v.city', kind: 'text', label: 'City' }, state: { sql: 'v.state', kind: 'text', label: 'State' },
  country: { sql: 'v.country', kind: 'text', label: 'Country (ISO)' }, language: { sql: 'v.language', kind: 'text', label: 'Language' },
  lifecycle: { sql: 'v.lifecycle::text', kind: 'text', label: 'Stage' }, closed_reason: { sql: 'v.closed_reason', kind: 'text', label: 'Closed reason' },
  source_l1: { sql: 'v.source_l1', kind: 'text', label: 'Source: channel' }, source_l2: { sql: 'v.source_l2', kind: 'text', label: 'Source: page/account' },
  source_l3: { sql: 'v.source_l3', kind: 'text', label: 'Source: campaign' }, source_l4: { sql: 'v.source_l4', kind: 'text', label: 'Source: ad/form' },
  owner: { sql: 'v.owner_user_id', kind: 'uuid', label: 'Owner (id)' }, consent: { sql: 'v.consent_status', kind: 'text', label: 'Consent' },
  deal_stage: { sql: 'v.deal_stage', kind: 'text', label: 'Deal stage' }, payment_status: { sql: 'v.last_payment_status', kind: 'text', label: 'Payment status' },
  attempts: { sql: 'v.attempts', kind: 'num', label: 'Attempts' }, total_calls: { sql: 'v.total_calls', kind: 'num', label: 'Total calls' },
  times_re_engaged: { sql: 'v.times_re_engaged', kind: 'num', label: 'Times re-engaged' }, total_paid: { sql: 'v.total_paid', kind: 'num', label: 'Total paid' }, priority: { sql: 'v.priority', kind: 'num', label: 'Priority' },
  created_at: { sql: 'v.created_at', kind: 'date', label: 'Created' }, last_call_at: { sql: 'v.last_call_at', kind: 'date', label: 'Last call' },
  next_followup_at: { sql: 'v.next_followup_at', kind: 'date', label: 'Next follow-up' }, closed_at: { sql: 'v.closed_at', kind: 'date', label: 'Closed' },
  is_customer: { sql: 'v.is_customer', kind: 'bool', label: 'Is customer' }, tags: { sql: 'v.tags', kind: 'tags', label: 'Tag' },
  student_grade: { sql: 's.grade', kind: 'num', label: 'Student grade', student: true }, student_stream: { sql: 's.stream', kind: 'text', label: 'Student stream', student: true },
  student_school: { sql: 's.school', kind: 'text', label: 'Student school', student: true },
}
export const QB_OPS = { eq: 'is', neq: 'is not', contains: 'contains', gt: 'greater / after', lt: 'less / before', empty: 'is empty', not_empty: 'is not empty' } as const
type Rule = { field: string; op: keyof typeof QB_OPS; value?: string }
export type Group = { join: 'and' | 'or'; rules: (Rule | Group)[] }
const ruleSchema: z.ZodType<Rule> = z.object({ field: z.string().refine((f) => f in QB_FIELDS), op: z.enum(Object.keys(QB_OPS) as [keyof typeof QB_OPS]), value: z.string().max(200).optional() })
const groupSchema: z.ZodType<Group> = z.lazy(() => z.object({ join: z.enum(['and', 'or']), rules: z.array(z.union([ruleSchema, groupSchema])).max(20) }))

function qbSql(g: Group, p: (v: unknown) => string, depth = 0): string | null {
  if (depth > 3) return null
  const parts = g.rules.map((r) => {
    if ('join' in r) return qbSql(r, p, depth + 1)
    const f = QB_FIELDS[r.field]!, v = r.value ?? ''
    const cast = f.kind === 'num' ? '::numeric' : f.kind === 'date' ? '::timestamptz' : f.kind === 'uuid' ? '::uuid' : f.kind === 'bool' ? '::boolean' : ''
    if (['eq', 'neq', 'gt', 'lt'].includes(r.op) && f.kind === 'num' && !/^-?\d+(\.\d+)?$/.test(v)) return null
    if (['eq', 'neq', 'gt', 'lt'].includes(r.op) && f.kind === 'date' && Number.isNaN(Date.parse(v))) return null
    if (f.kind === 'uuid' && r.op !== 'empty' && r.op !== 'not_empty' && !/^[0-9a-f-]{36}$/.test(v)) return null
    // bind the value ONLY in the branch that is used: an unused placeholder has no type and Postgres rejects the query
    let cond: string | null = null
    const isText = f.kind === 'text', ordered = f.kind === 'num' || f.kind === 'date'
    if (r.op === 'empty') cond = f.kind === 'tags' ? `cardinality(${f.sql}) = 0` : `${f.sql} is null`
    else if (r.op === 'not_empty') cond = f.kind === 'tags' ? `cardinality(${f.sql}) > 0` : `${f.sql} is not null`
    else if (f.kind === 'tags') cond = r.op === 'neq' ? `not ${p(v.toLowerCase())}::text = any (${f.sql})` : r.op === 'eq' || r.op === 'contains' ? `${p(v.toLowerCase())}::text = any (${f.sql})` : null
    else if (r.op === 'eq') cond = isText ? `lower(${f.sql}) = lower(${p(v)}::text)` : `${f.sql} = ${p(v)}${cast}`
    else if (r.op === 'neq') cond = isText ? `lower(${f.sql}) is distinct from lower(${p(v)}::text)` : `${f.sql} is distinct from ${p(v)}${cast}`
    else if (r.op === 'contains') cond = isText ? `${f.sql} ilike ${p('%' + v.replace(/[%_\\]/g, '\\$&') + '%')}::text` : null
    else if (r.op === 'gt' && ordered) cond = `${f.sql} > ${p(v)}${cast}`
    else if (r.op === 'lt' && ordered) cond = `${f.sql} < ${p(v)}${cast}`
    if (!cond) return null
    return f.student ? `exists (select from students s where s.lead_id = v.id and ${cond})` : cond
  }).filter(Boolean)
  return parts.length ? `(${parts.join(g.join === 'or' ? ' or ' : ' and ')})` : null
}

const uuid = z.uuid().optional().catch(undefined)
const text = (n = 120) => z.string().trim().max(n).optional().catch(undefined)
const flag = z.enum(['1']).optional().catch(undefined)
export const leadFilterSchema = z.object({
  view: z.enum(Object.keys(SMART_VIEWS) as [SmartView, ...SmartView[]]).catch('active'),
  q: text(80), owner: uuid, centre: uuid, district: uuid, list: uuid, batch: uuid,
  source: text(), l2: text(), l3: text(), l4: text(), tag: text(40), country: text(2),
  lifecycle: z.enum(['ENQUIRY', 'PROSPECT', 'INTERESTED', 'DEAD', 'ENROLLED']).optional().catch(undefined),
  grade: z.coerce.number().int().min(8).max(12).optional().catch(undefined),
  rechurned: flag, junk: flag, touched: flag, opportunity: flag, pool: flag, unowned: flag,
  sla: z.enum(['15', '24', 'untouched']).optional().catch(undefined),
  from: z.iso.date().optional().catch(undefined), to: z.iso.date().optional().catch(undefined),
  closed_from: z.iso.date().optional().catch(undefined), closed_to: z.iso.date().optional().catch(undefined),
  qb: z.string().max(8000).optional().catch(undefined),          // JSON of Group
  ids: z.array(z.uuid()).max(5000).optional().catch(undefined),
  cursor: z.string().regex(/^[^|]+\|[0-9a-f-]{36}$/).optional().catch(undefined),
})
export type LeadFilters = z.infer<typeof leadFilterSchema>
export type Scope = { role: string; centre_id: string | null; district_id: string | null; user_id: string }

// The WHERE clause alone: reports aggregate over exactly the rows the list would show.
export function leadWhere(input: unknown, params: unknown[], scope?: Scope): string {
  const f = leadFilterSchema.parse(input ?? {})
  const p = (v: unknown) => `$${params.push(v)}`
  const where: string[] = [SMART_VIEWS[f.view].where, 'v.anonymised_at is null', 'v.merged_into_id is null']
  // `scope` is a PERFORMANCE HINT, never the security boundary: lead_list already restricts rows from the session
  // claims. Repeating the caller's own centre/district as a constant lets Postgres walk the (centre, created_at)
  // index in order; passing someone else's scope just returns nothing (tested).
  if (scope?.centre_id) where.push(`v.current_centre_id = ${p(scope.centre_id)}`)
  else if (scope?.district_id) where.push(`v.district_id = ${p(scope.district_id)}`)
  if (f.q) where.push(`v.id = any ((select app.search_lead_ids(${p(f.q)}))::uuid[])`)
  if (f.owner) where.push(`v.owner_user_id = ${p(f.owner)}`)
  if (f.centre) where.push(`v.current_centre_id = ${p(f.centre)}`)
  if (f.district) where.push(`v.district_id = ${p(f.district)}`)
  if (f.lifecycle) where.push(`v.lifecycle = ${p(f.lifecycle)}`)
  if (f.source) where.push(`v.source_l1 = ${p(f.source)}`)
  if (f.l2) where.push(`v.source_l2 = ${p(f.l2)}`)
  if (f.l3) where.push(`v.source_l3 = ${p(f.l3)}`)
  if (f.l4) where.push(`v.source_l4 = ${p(f.l4)}`)
  if (f.country) where.push(`v.country = ${p(f.country.toUpperCase())}`)
  if (f.tag) where.push(`${p(f.tag.toLowerCase())} = any (v.tags)`)
  if (f.batch) where.push(`v.import_batch_id = ${p(f.batch)}`)
  if (f.grade) where.push(`exists (select from students s where s.lead_id = v.id and s.grade = ${p(f.grade)})`)
  if (f.rechurned) where.push('v.times_re_engaged > 0')
  if (f.touched) where.push('v.first_touch_at is not null')
  if (f.opportunity) where.push('v.became_opportunity_at is not null')
  if (f.pool) where.push('v.current_centre_id is null')
  if (f.unowned) where.push('v.owner_user_id is null')
  if (f.junk) where.push("v.lifecycle = 'DEAD' and exists (select from dispositions jd where jd.id = v.last_disposition_id and jd.sentiment = 'junk')")
  if (f.sla === '15') where.push("v.sla_15_breached_at is not null and v.attempts = 0 and v.lifecycle = 'ENQUIRY'")
  if (f.sla === '24') where.push("v.sla_24_breached_at is not null and v.attempts = 0 and v.lifecycle = 'ENQUIRY'")
  if (f.sla === 'untouched') where.push("v.attempts = 0 and v.lifecycle = 'ENQUIRY'")
  // static list = membership rows; dynamic list (LS-2) = its saved filters, evaluated live so it is never stale
  if (f.list) where.push(`(exists (select from list_members m where m.list_id = ${p(f.list)} and m.lead_id = v.id))`)
  if (f.from) where.push(`v.created_at >= ${p(f.from)}::date`)
  if (f.to) where.push(`v.created_at < ${p(f.to)}::date + 1`)
  if (f.closed_from) where.push(`v.closed_at >= ${p(f.closed_from)}::date`)
  if (f.closed_to) where.push(`v.closed_at < ${p(f.closed_to)}::date + 1`)
  if (f.ids?.length) where.push(`v.id = any (${p(f.ids)}::uuid[])`)
  if (f.qb) {
    try { const g = groupSchema.parse(JSON.parse(f.qb)); const sql = qbSql(g, p); if (sql) where.push(sql) } catch { /* malformed builder input is ignored, never executed */ }
  }
  if (f.cursor) {
    const [at, id] = f.cursor.split('|')
    where.push(`(v.created_at, v.id) < (${p(at)}::timestamptz, ${p(id)}::uuid)`)
  }
  return where.join(' and ')
}

export function buildLeadQuery(input: unknown, limit: number, scope?: Scope): { sql: string; params: unknown[] } {
  const params: unknown[] = []
  const where = leadWhere(input, params, scope)
  return {
    params,
    sql: `select v.id, v.name, v.primary_phone, v.email, v.lifecycle, v.closed_reason, v.country, v.city, v.tags, v.attempts, v.priority,
                 v.source_l1, v.source_l2, v.source_l3, v.source_l4, v.next_followup_at, v.next_followup_origin, v.first_touch_at,
                 v.last_disposition_at, v.created_at, v.owner_user_id, v.deal_stage, v.total_paid, v.last_payment_status, v.sla_15_breached_at,
                 v.created_at::text || '|' || v.id as cursor,   -- text keeps microseconds; a JS Date would drop rows created in the same ms
                 u.display_name as owner_name, c.code as centre_code, d.name as disposition
          from lead_list v left join users u on u.id = v.owner_user_id left join centres c on c.id = v.current_centre_id
          left join dispositions d on d.id = v.last_disposition_id
          where ${where} order by v.created_at desc, v.id desc limit ${Math.min(Math.max(limit | 0, 1), 1000)}`,
  }
}

export const EXPORT_COLUMNS = [
  { key: 'name', header: 'Name' }, { key: 'primary_phone', header: 'Phone' }, { key: 'email', header: 'Email' },
  { key: 'lifecycle', header: 'Lifecycle' }, { key: 'disposition', header: 'Last disposition' }, { key: 'closed_reason', header: 'Closed reason' },
  { key: 'owner_name', header: 'Owner' }, { key: 'centre_code', header: 'Centre' }, { key: 'country', header: 'Country' }, { key: 'city', header: 'City' },
  { key: 'source_l1', header: 'Source' }, { key: 'source_l2', header: 'Page/Account' }, { key: 'source_l3', header: 'Campaign' }, { key: 'source_l4', header: 'Ad/Form' },
  { key: 'attempts', header: 'Attempts' }, { key: 'next_followup_at', header: 'Next follow-up (UTC)' }, { key: 'deal_stage', header: 'Deal stage' },
  { key: 'last_payment_status', header: 'Payment status' }, { key: 'total_paid', header: 'Total paid' }, { key: 'tags', header: 'Tags' }, { key: 'created_at', header: 'Created (UTC)' },
] as const
