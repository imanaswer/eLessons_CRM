import { bodyHash, metaChallenge, metaVerified, ok, readRaw, store } from '@/lib/webhooks.ts'
import { parseWebhook } from '@/lib/whatsapp.ts'
export const GET = (req: Request) => metaChallenge(req)
export async function POST(req: Request) {
  const raw = await readRaw(req); if (raw === null) return ok({ error: 'too large' }, 413)
  if (!metaVerified(raw, req)) return ok({ error: 'bad signature' }, 401)
  let body: unknown; try { body = JSON.parse(raw) } catch { return ok({ error: 'bad json' }, 400) }
  let n = 0
  for (const ch of parseWebhook(body)) {
    for (const m of ch.messages) { await store('whatsapp', ch.phoneNumberId, null, 'whatsapp', `wa:msg:${m.id}`, { ...m, phone_number_id: ch.phoneNumberId }, m.id); n++ }
    for (const s of ch.statuses) { await store('whatsapp', ch.phoneNumberId, null, 'whatsapp_status', `wa:status:${s.id}:${s.status}`, { ...s, phone_number_id: ch.phoneNumberId }, s.id); n++ }
  }
  if (!n) await store('whatsapp', 'unknown', null, 'whatsapp', `wa:raw:${bodyHash(raw)}`, body).catch(() => null)
  return ok({ received: n })
}
