'use server'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { userMessage } from '@/lib/errors.ts'
import { leadFilterSchema } from '@/lib/leads-query.ts'
import { tenant } from '@/lib/session.ts'
import type { FormState } from '../actions.ts'
export async function saveViewAction(_: FormState, form: FormData): Promise<FormState> {
  const p = z.object({ name: z.string().trim().min(1).max(60), filters: z.string().max(8000), shared: z.literal('on').optional() }).safeParse(Object.fromEntries(form))
  if (!p.success) return { error: 'Give the view a name.' }
  let filters: unknown; try { filters = leadFilterSchema.parse(JSON.parse(p.data.filters)) } catch { return { error: userMessage(new Error('INVALID')) } }
  try { await tenant((db, c) => db.query('insert into saved_views (org_id, user_id, shared_centre_id, name, filters) values ($1,$2,$3,$4,$5)', [c.org_id, c.user_id, p.data.shared ? c.centre_id : null, p.data.name, JSON.stringify({ ...(filters as object), cursor: undefined, ids: undefined })])) } catch (e) { return { error: userMessage(e) } }
  revalidatePath('/leads'); return { ok: 'View saved.' }
}
