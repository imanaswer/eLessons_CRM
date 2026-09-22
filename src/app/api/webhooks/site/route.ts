// elessons.net forms + LMS events. Authenticated with the connection's API key (Bearer). Body: {event, phone, email, name, ...}
// events: lead (default) | demo_completed | checkout_started | checkout_abandoned | signup | lms_activity
import { bearerHash, bodyHash, ok, readRaw, store } from '@/lib/webhooks.ts'
export async function POST(req: Request) {
  const raw = await readRaw(req); if (raw === null) return ok({ error: 'too large' }, 413)
  const key = bearerHash(req); if (!key) return ok({ error: 'missing bearer key' }, 401)
  let body: Record<string, unknown>; try { body = JSON.parse(raw) } catch { return ok({ error: 'bad json' }, 400) }
  const channel = ['demo_completed', 'checkout_started', 'checkout_abandoned', 'lms_activity'].includes(String(body.event)) ? 'lms' : 'website'
  const id = await store('website', null, key, channel, `site:${body.event_id ?? bodyHash(raw)}`, body, body.event_id ? String(body.event_id) : null)
  return id ? ok({ received: true, id }) : ok({ error: 'unknown api key' }, 401)
}
