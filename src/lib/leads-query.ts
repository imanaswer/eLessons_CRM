// One filter -> SQL builder shared by the lead list and the export worker, so an export is exactly
// "what the list shows". All filtering is server-side and parameterised; scope comes from RLS, not from here.
import { z } from 'zod'

export const SMART_VIEWS = {
  active: { label: 'All Active', where: "v.lifecycle in ('ENQUIRY','PROSPECT','INTERESTED')" },
  enquiry: { label: 'Enquiry', where: "v.lifecycle = 'ENQUIRY'" },
  assigned_today: { label: 'Assigned Today', where: "v.assigned_at >= date_trunc('day', now()) and v.lifecycle in ('ENQUIRY','PROSPECT','INTERESTED')" },
  never_picked: { label: 'Never Picked', where: "v.first_touch_at is null and v.lifecycle = 'ENQUIRY'" },
  prospect: { label: 'Prospect', where: "v.lifecycle = 'PROSPECT'" },
  interested: { label: 'Interested', where: "v.lifecycle = 'INTERESTED'" },
  customer: { label: 'Is Customer', where: 'v.is_customer' },
  due: { label: 'Follow-up Due', where: "v.next_followup_at < date_trunc('day', now()) + interval '1 day' and v.next_followup_at >= date_trunc('day', now())" },
  overdue: { label: 'Overdue', where: "v.next_followup_at < now() and v.lifecycle in ('ENQUIRY','PROSPECT','INTERESTED')" },
  unassigned: { label: 'Unassigned', where: "v.owner_user_id is null and v.lifecycle in ('ENQUIRY','PROSPECT','INTERESTED')" },
  worked: { label: 'Worked Leads', where: "v.lifecycle in ('DEAD','ENROLLED')" },
} as const
export type SmartView = keyof typeof SMART_VIEWS

const uuid = z.uuid().optional().catch(undefined)
export const leadFilterSchema = z.object({
  view: z.enum(Object.keys(SMART_VIEWS) as [SmartView, ...SmartView[]]).catch('active'),
  q: z.string().trim().max(80).optional().catch(undefined),
  owner: uuid, centre: uuid, district: uuid, list: uuid,
  source: z.string().max(80).optional().catch(undefined),
  tag: z.string().max(40).optional().catch(undefined),
  from: z.iso.date().optional().catch(undefined),
  to: z.iso.date().optional().catch(undefined),
  ids: z.array(z.uuid()).max(5000).optional().catch(undefined),
  cursor: z.string().regex(/^[^|]+\|[0-9a-f-]{36}$/).optional().catch(undefined),
})
export type LeadFilters = z.infer<typeof leadFilterSchema>

export function buildLeadQuery(input: unknown, limit: number): { sql: string; params: unknown[] } {
  const f = leadFilterSchema.parse(input ?? {})
  const params: unknown[] = []
  const p = (v: unknown) => `$${params.push(v)}`
  const where = [SMART_VIEWS[f.view].where, 'v.anonymised_at is null']
  if (f.q) {
    const digits = f.q.replace(/\D/g, '')
    where.push(digits.length >= 4 && digits.length === f.q.replace(/[\s+()-]/g, '').length
      ? `v.id in (select app.search_lead_ids_by_phone(${p(digits)}))`
      : `v.name ilike ${p('%' + f.q.replace(/[%_\\]/g, '\\$&') + '%')}`)
  }
  if (f.owner) where.push(`v.owner_user_id = ${p(f.owner)}`)
  if (f.centre) where.push(`v.current_centre_id = ${p(f.centre)}`)
  if (f.district) where.push(`v.district_id = ${p(f.district)}`)
  if (f.source) where.push(`v.source_l1 = ${p(f.source)}`)
  if (f.tag) where.push(`${p(f.tag)} = any (v.tags)`)
  if (f.list) where.push(`exists (select from list_members m where m.list_id = ${p(f.list)} and m.lead_id = v.id)`)
  if (f.from) where.push(`v.created_at >= ${p(f.from)}::date`)
  if (f.to) where.push(`v.created_at < ${p(f.to)}::date + 1`)
  if (f.ids?.length) where.push(`v.id = any (${p(f.ids)}::uuid[])`)
  if (f.cursor) {
    const [at, id] = f.cursor.split('|')
    where.push(`(v.created_at, v.id) < (${p(at)}::timestamptz, ${p(id)}::uuid)`)
  }
  return {
    params,
    sql: `select v.id, v.name, v.primary_phone, v.email, v.lifecycle, v.closed_reason, v.country, v.city, v.tags, v.attempts,
                 v.source_l1, v.source_l2, v.source_l3, v.source_l4, v.next_followup_at, v.next_followup_origin, v.first_touch_at,
                 v.last_disposition_at, v.created_at, v.owner_user_id,
                 v.created_at::text || '|' || v.id as cursor,   -- text keeps microseconds; a JS Date would drop rows created in the same ms
                 u.display_name as owner_name, c.code as centre_code, d.name as disposition
          from lead_list v left join users u on u.id = v.owner_user_id left join centres c on c.id = v.current_centre_id
          left join dispositions d on d.id = v.last_disposition_id
          where ${where.join(' and ')} order by v.created_at desc, v.id desc limit ${Math.min(Math.max(limit | 0, 1), 1000)}`,
  }
}

export const EXPORT_COLUMNS = [
  { key: 'name', header: 'Name' }, { key: 'primary_phone', header: 'Phone' }, { key: 'email', header: 'Email' },
  { key: 'lifecycle', header: 'Lifecycle' }, { key: 'disposition', header: 'Last disposition' }, { key: 'closed_reason', header: 'Closed reason' },
  { key: 'owner_name', header: 'Owner' }, { key: 'centre_code', header: 'Centre' }, { key: 'country', header: 'Country' }, { key: 'city', header: 'City' },
  { key: 'source_l1', header: 'Source' }, { key: 'source_l2', header: 'Page/Account' }, { key: 'source_l3', header: 'Campaign' }, { key: 'source_l4', header: 'Ad/Form' },
  { key: 'attempts', header: 'Attempts' }, { key: 'next_followup_at', header: 'Next follow-up (UTC)' }, { key: 'tags', header: 'Tags' }, { key: 'created_at', header: 'Created (UTC)' },
] as const
