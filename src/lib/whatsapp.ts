// WhatsApp Cloud API. NOT VERIFIED AGAINST THE LIVE API: written to the documented contract, exercised with a mocked fetch.
import type { Fetch } from './meta.ts'
const V = process.env.META_GRAPH_VERSION ?? 'v21.0'
export async function sendMessage(f: Fetch, phoneNumberId: string, token: string, m: { to: string; body: string | null; kind: string; template_name: string | null; language: string; header_media_url: string | null; vars?: string[] }) {
  const payload = m.kind === 'template'
    ? { messaging_product: 'whatsapp', to: m.to, type: 'template', template: { name: m.template_name, language: { code: m.language },
        components: [...(m.header_media_url ? [{ type: 'header', parameters: [{ type: 'image', image: { link: m.header_media_url } }] }] : []),
                     ...(m.vars?.length ? [{ type: 'body', parameters: m.vars.map((text) => ({ type: 'text', text })) }] : [])] } }
    : { messaging_product: 'whatsapp', to: m.to, type: 'text', text: { body: m.body ?? '' } }
  const res = await f(`https://graph.facebook.com/${V}/${phoneNumberId}/messages`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(payload) })
  const body = (await res.json().catch(() => ({}))) as { messages?: { id: string }[]; error?: { message: string } }
  if (!res.ok || body.error) throw new Error(body.error?.message ?? `WhatsApp ${res.status}`)
  return body.messages?.[0]?.id ?? null
}
// Parse one webhook "change" into inbound messages and status updates
export function parseWebhook(body: unknown) {
  const out: { phoneNumberId: string; messages: { wa_id: string; id: string; kind: string; body: string | null; media: string | null; at: Date }[]; statuses: { id: string; status: string; at: Date }[] }[] = []
  const entries = (body as { entry?: { changes?: { value?: { metadata?: { phone_number_id?: string }; messages?: Record<string, unknown>[]; statuses?: Record<string, unknown>[] } }[] }[] }).entry ?? []
  for (const e of entries) for (const c of e.changes ?? []) {
    const v = c.value; if (!v?.metadata?.phone_number_id) continue
    out.push({ phoneNumberId: v.metadata.phone_number_id,
      messages: (v.messages ?? []).map((m) => { const t = String(m.type ?? 'unknown'), kind = ['text', 'image', 'document', 'audio', 'video', 'interactive', 'reaction'].includes(t) ? t : 'unknown'
        const text = t === 'text' ? (m.text as { body?: string })?.body : t === 'interactive' ? ((m.interactive as { button_reply?: { title?: string }; list_reply?: { title?: string } })?.button_reply?.title ?? (m.interactive as { list_reply?: { title?: string } })?.list_reply?.title) : (m[t] as { caption?: string })?.caption
        return { wa_id: String(m.from), id: String(m.id), kind, body: text ?? null, media: (m[t] as { id?: string })?.id ?? null, at: new Date(Number(m.timestamp) * 1000) } }),
      statuses: (v.statuses ?? []).map((s) => ({ id: String(s.id), status: String(s.status), at: new Date(Number(s.timestamp) * 1000) })) })
  }
  return out
}
