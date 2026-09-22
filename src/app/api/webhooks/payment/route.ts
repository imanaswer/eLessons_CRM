// Payment gateway webhook. GATEWAY IS NOT DECIDED (NEEDED.md): this accepts the generic shape below, signed with the
// connection's secret (HMAC-SHA256 of the raw body in X-Signature), and a per-gateway adapter maps the vendor's fields.
import { hmacHex, safeEqual } from '@/lib/crypto.ts'
import { pool } from '@/lib/db.ts'
import { bodyHash, ok, readRaw, store } from '@/lib/webhooks.ts'
import { decrypt } from '@/lib/crypto.ts'

const ADAPTERS: Record<string, (b: Record<string, any>) => Record<string, unknown>> = {
  generic: (b) => b,      // {status, amount, currency, payment_id, phone, email, name, student_name, grade, access_end_date, ref, deal_id}
  razorpay: (b) => { const p = b.payload?.payment?.entity ?? {}; return { status: b.event?.replace('payment.', ''), amount: p.amount / 100, currency: p.currency, payment_id: p.id, phone: p.contact, email: p.email, ref: p.notes?.ref, student_name: p.notes?.student_name, grade: p.notes?.grade } },
  stripe: (b) => { const o = b.data?.object ?? {}; return { status: b.type === 'checkout.session.completed' ? 'received' : b.type?.split('.').pop(), amount: (o.amount_total ?? o.amount) / 100, currency: (o.currency ?? '').toUpperCase(), payment_id: o.id, phone: o.customer_details?.phone, email: o.customer_details?.email ?? o.customer_email, name: o.customer_details?.name, ref: o.metadata?.ref } },
}
export async function POST(req: Request) {
  const raw = await readRaw(req); if (raw === null) return ok({ error: 'too large' }, 413)
  const gateway = new URL(req.url).searchParams.get('gateway') ?? 'generic'
  const { rows: [conn] } = await pool.query('select * from app.payment_connection($1)', [gateway])
  if (!conn?.secret_enc) return ok({ error: 'no payment connection configured' }, 503)
  const sig = req.headers.get('x-signature') ?? req.headers.get('x-razorpay-signature') ?? req.headers.get('stripe-signature') ?? ''
  if (!safeEqual(sig.replace(/^sha256=/, ''), hmacHex(decrypt(conn.secret_enc), raw))) return ok({ error: 'bad signature' }, 401)
  let body: Record<string, unknown>; try { body = JSON.parse(raw) } catch { return ok({ error: 'bad json' }, 400) }
  const p = (ADAPTERS[gateway] ?? ADAPTERS.generic!)(body)
  await store('payment', conn.external_id, null, 'payment', `pay:${gateway}:${p.payment_id ?? bodyHash(raw)}:${p.status ?? ''}`, { ...p, gateway, raw: body }, String(p.payment_id ?? ''))
  return ok()
}
