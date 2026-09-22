// Meta Graph API client: Lead Ads, Marketing API insights, Conversions API. One G-TEC app, per-centre page tokens.
// NOT VERIFIED AGAINST LIVE META: written to the documented v21.0 contract and exercised with a mocked fetch.
// It cannot be run for real until the app review in NEEDED.md is approved.
export type Fetch = typeof fetch
const V = process.env.META_GRAPH_VERSION ?? 'v21.0'
const G = `https://graph.facebook.com/${V}`

export class MetaError extends Error {
  code?: number; reconnect: boolean
  constructor(message: string, code?: number) { super(message); this.code = code; this.reconnect = code === 190 || code === 102 || code === 10 || code === 200 }
}
async function call<T>(f: Fetch, url: string, init?: RequestInit): Promise<T> {
  const res = await f(url, init)
  const body = (await res.json().catch(() => ({}))) as { error?: { message: string; code?: number; type?: string } }
  if (!res.ok || body.error) throw new MetaError(`${body.error?.type ?? 'MetaError'}: ${body.error?.message ?? res.status}`, body.error?.code)
  return body as T
}
const qs = (o: Record<string, string>) => new URLSearchParams(o).toString()

export const SCOPES = ['pages_show_list', 'pages_read_engagement', 'pages_manage_metadata', 'leads_retrieval', 'pages_manage_ads', 'ads_read', 'business_management']
export const oauthUrl = (state: string, redirect: string) =>
  `https://www.facebook.com/${V}/dialog/oauth?${qs({ client_id: process.env.META_APP_ID ?? '', redirect_uri: redirect, state, scope: SCOPES.join(','), response_type: 'code' })}`

export async function exchangeCode(f: Fetch, code: string, redirect: string) {
  const app = { client_id: process.env.META_APP_ID ?? '', client_secret: process.env.META_APP_SECRET ?? '' }
  const short = await call<{ access_token: string }>(f, `${G}/oauth/access_token?${qs({ ...app, redirect_uri: redirect, code })}`)
  // long-lived user token => page tokens derived from it do not expire on the 1-hour clock
  return call<{ access_token: string; expires_in?: number }>(f, `${G}/oauth/access_token?${qs({ ...app, grant_type: 'fb_exchange_token', fb_exchange_token: short.access_token })}`)
}
export type Page = { id: string; name: string; access_token: string; business?: { id: string } }
export const listPages = (f: Fetch, userToken: string) => call<{ data: Page[] }>(f, `${G}/me/accounts?${qs({ fields: 'id,name,access_token,business', limit: '200', access_token: userToken })}`).then((r) => r.data)
export const subscribePage = (f: Fetch, pageId: string, pageToken: string) =>
  call<{ success: boolean }>(f, `${G}/${pageId}/subscribed_apps?${qs({ subscribed_fields: 'leadgen', access_token: pageToken })}`, { method: 'POST' })
export const listForms = (f: Fetch, pageId: string, pageToken: string) =>
  call<{ data: { id: string; name: string; status: string }[] }>(f, `${G}/${pageId}/leadgen_forms?${qs({ fields: 'id,name,status', limit: '200', access_token: pageToken })}`).then((r) => r.data)

export type MetaLead = { id: string; created_time: string; form_id?: string; ad_id?: string; ad_name?: string; campaign_id?: string; campaign_name?: string; field_data: { name: string; values: string[] }[] }
export const fetchLead = (f: Fetch, leadgenId: string, pageToken: string) =>
  call<MetaLead>(f, `${G}/${leadgenId}?${qs({ fields: 'id,created_time,form_id,ad_id,ad_name,campaign_id,campaign_name,field_data', access_token: pageToken })}`)

// Default mapping for Meta's standard questions; custom questions are mapped per form in the Map screen.
export const DEFAULT_MAPPING: Record<string, string> = {
  full_name: 'name', first_name: 'name', phone_number: 'phone', phone: 'phone', email: 'email', city: 'city', state: 'state', country: 'country',
  student_name: 'student_name', child_name: 'student_name', grade: 'grade', class: 'grade', school: 'school', school_name: 'school',
}
export function mapLeadFields(fieldData: MetaLead['field_data'], mapping: Record<string, string> = {}): Record<string, string> {
  const m = { ...DEFAULT_MAPPING, ...mapping }, out: Record<string, string> = {}
  for (const f of fieldData) { const to = m[f.name.toLowerCase()]; if (to && f.values[0] && !out[to]) out[to] = f.values[0] }
  return out
}

export type SpendRow = { date_start: string; campaign_id: string; campaign_name: string; ad_id: string; ad_name: string; spend: string; impressions: string; clicks: string; account_currency: string }
export const fetchSpend = (f: Fetch, adAccountId: string, token: string, since: string, until: string) =>
  call<{ data: SpendRow[] }>(f, `${G}/act_${adAccountId.replace(/^act_/, '')}/insights?${qs({ level: 'ad', time_increment: '1', limit: '500',
    fields: 'campaign_id,campaign_name,ad_id,ad_name,spend,impressions,clicks,account_currency', time_range: JSON.stringify({ since, until }), access_token: token })}`).then((r) => r.data)

// Conversions API. ONLY the parent's hashed phone/email are sent; nothing about the student (PRD s14 "Minors' data").
export function capiPayload(e: { event_name: string; event_id: string; event_time: number; phone_hash: string; email_hash?: string | null; lead_gen_id?: string | null; value?: number; currency?: string }) {
  return { data: [{ event_name: e.event_name, event_time: e.event_time, event_id: e.event_id, action_source: 'system_generated',
    user_data: { ph: [e.phone_hash], ...(e.email_hash ? { em: [e.email_hash] } : {}), ...(e.lead_gen_id ? { lead_id: e.lead_gen_id } : {}) },
    custom_data: { event_source: 'crm', lead_event_source: 'eLessons CRM', ...(e.value ? { value: e.value, currency: e.currency } : {}) } }] }
}
export const sendCapi = (f: Fetch, pixelId: string, token: string, payload: ReturnType<typeof capiPayload>) =>
  call<{ events_received: number }>(f, `${G}/${pixelId}/events?${qs({ access_token: token })}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) })
