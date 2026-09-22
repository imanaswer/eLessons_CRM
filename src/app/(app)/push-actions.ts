'use server'
import { headers } from 'next/headers'
import { z } from 'zod'
import { tenant } from '@/lib/session.ts'
export async function savePushAction(json: string) {
  const s = z.object({ endpoint: z.url(), keys: z.object({ p256dh: z.string(), auth: z.string() }) }).parse(JSON.parse(json))
  const ua = (await headers()).get('user-agent')
  await tenant((db, c) => db.query('insert into push_subscriptions (user_id, endpoint, keys, user_agent) values ($1,$2,$3,$4) on conflict (endpoint) do update set keys = excluded.keys, failed_at = null', [c.user_id, s.endpoint, JSON.stringify(s.keys), ua]))
}
