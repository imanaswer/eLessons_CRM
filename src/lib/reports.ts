// Funnel report (RP-1, RP-2). Aggregates over lead_list with the SAME where-clause as the lead list, so every number
// drills down to exactly the rows behind it. Pivot expressions are a whitelist; nothing from the request reaches SQL.
import { leadWhere, type Scope } from './leads-query.ts'

export const PIVOTS = {
  source: { label: 'Source (channel)', expr: 'v.source_l1', filter: 'source' }, page: { label: 'Page / account', expr: 'v.source_l2', filter: 'l2' },
  campaign: { label: 'Campaign', expr: 'v.source_l3', filter: 'l3' }, ad: { label: 'Ad / form', expr: 'v.source_l4', filter: 'l4' },
  centre: { label: 'Centre', expr: 'c.code', filter: 'centre', id: 'v.current_centre_id' }, district: { label: 'District', expr: 'dt.code', filter: 'district', id: 'v.district_id' },
  user: { label: 'User', expr: 'u.display_name', filter: 'owner', id: 'v.owner_user_id' }, upload: { label: 'Upload batch', expr: 'b.filename', filter: 'batch', id: 'v.import_batch_id' },
  tag: { label: 'Tag', expr: 't.tag', filter: 'tag' }, grade: { label: 'Grade', expr: 's.grade::text', filter: 'grade' }, country: { label: 'Country', expr: 'v.country', filter: 'country' },
} as const
export type Pivot = keyof typeof PIVOTS

// Ratio definitions (confirm against Salesmax: NEEDED.md):
//   Work Done % = leads with at least one attempt / total      Junk % = closed with a junk disposition / total
//   Deal Conversion % = leads that became an opportunity / total      Win % = enrolled / leads that became an opportunity
export function funnelQuery(pivot: Pivot, filters: unknown, scope?: Scope) {
  const P = PIVOTS[pivot], params: unknown[] = []
  const where = leadWhere({ ...(filters as object), view: 'all', cursor: undefined }, params, scope)
  const idExpr = 'id' in P ? P.id : P.expr
  return {
    params,
    sql: `select ${P.expr} as key, (${idExpr})::text as filter_value, count(*)::int as total,
            count(*) filter (where v.lifecycle = 'ENQUIRY')::int as enquiry, count(*) filter (where v.times_re_engaged > 0)::int as rechurned,
            count(*) filter (where v.lifecycle = 'PROSPECT')::int as prospect, count(*) filter (where v.lifecycle = 'INTERESTED')::int as interested,
            count(*) filter (where v.lifecycle = 'DEAD')::int as dead, count(*) filter (where v.lifecycle = 'ENROLLED')::int as enrolled,
            coalesce(sum(v.total_paid), 0)::float as revenue,
            count(*) filter (where v.first_touch_at is not null)::int as touched, count(*) filter (where v.became_opportunity_at is not null)::int as opportunities,
            count(*) filter (where v.lifecycle = 'DEAD' and jd.sentiment = 'junk')::int as junk
          from lead_list v left join centres c on c.id = v.current_centre_id left join districts dt on dt.id = v.district_id
          left join users u on u.id = v.owner_user_id left join import_batches b on b.id = v.import_batch_id
          left join dispositions jd on jd.id = v.last_disposition_id
          ${pivot === 'tag' ? 'left join lateral unnest(v.tags) t(tag) on true' : ''} ${pivot === 'grade' ? 'left join students s on s.lead_id = v.id' : ''}
          where ${where} group by 1, 2 order by total desc limit 500`,
  }
}
export const pct = (n: number, d: number) => (d ? `${Math.round((n / d) * 1000) / 10}%` : '—')
