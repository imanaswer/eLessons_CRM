// Generic lead API (brief s7 "API"). POST {phone, name, email, city, state, students:[{name, grade}], source:{l1,l2,l3,l4}, custom:{}, idempotency_key}
import { bearerHash, bodyHash, ok, readRaw, store } from '@/lib/webhooks.ts'
export async function POST(req: Request) {
  const raw = await readRaw(req); if (raw === null) return ok({ error: 'too large' }, 413)
  const key = bearerHash(req); if (!key) return ok({ error: 'missing bearer key' }, 401)
  let body: Record<string, unknown>; try { body = JSON.parse(raw) } catch { return ok({ error: 'bad json' }, 400) }
  if (!body.phone) return ok({ error: 'phone is required' }, 422)
  const id = await store('api', null, key, 'api', `api:${body.idempotency_key ?? bodyHash(raw)}`, body)
  return id ? ok({ accepted: true, event_id: id }, 202) : ok({ error: 'unknown api key' }, 401)
}
