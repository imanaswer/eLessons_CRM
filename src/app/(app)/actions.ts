'use server'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { logout, setImpersonation } from '@/lib/auth-core.ts'
import { hashPassword, passwordProblem } from '@/lib/password.ts'
import { userMessage } from '@/lib/errors.ts'
import { clientIp, SESSION_COOKIE, tenant } from '@/lib/session.ts'

export type FormState = { error?: string; ok?: string } | null
const token = async () => (await cookies()).get(SESSION_COOKIE)?.value

export async function logoutAction() {
  const t = await token()
  if (t) await logout(t, await clientIp())
  ;(await cookies()).delete(SESSION_COOKIE)
  redirect('/login')
}

export async function impersonateAction(form: FormData) {
  const centre = z.uuid().nullable().parse(form.get('centre_id') || null)
  const t = await token()
  if (t) await setImpersonation(t, centre, await clientIp())   // authorised + audited in the database
  revalidatePath('/', 'layout')
  redirect(centre ? '/' : '/admin/centres')
}

async function run(path: string, okMsg: string, fn: () => Promise<unknown>): Promise<FormState> {
  try { await fn() } catch (e) { return { error: userMessage(e) } }
  revalidatePath(path)
  return { ok: okMsg }
}

const districtSchema = z.object({ code: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{2,8}$/, 'Code: 2-8 letters or digits'), name: z.string().trim().min(2).max(80) })
export async function createDistrictAction(_: FormState, form: FormData): Promise<FormState> {
  const p = districtSchema.safeParse(Object.fromEntries(form))
  if (!p.success) return { error: p.error.issues[0]!.message }
  return run('/admin/districts', `District ${p.data.code} created.`, () =>
    tenant((db, c) => db.query('insert into districts (org_id, code, name) values ($1,$2,$3)', [c.org_id, p.data.code, p.data.name])))
}

const centreSchema = z.object({
  district_id: z.uuid(), name: z.string().trim().min(2).max(80),
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{2,8}-[0-9]{2,4}$/, 'Code looks like EKM-07'),
  timezone: z.enum(['Asia/Kolkata', 'Asia/Dubai', 'Asia/Riyadh', 'Asia/Qatar', 'Asia/Kuwait', 'Asia/Muscat', 'Asia/Bahrain']),
})
export async function createCentreAction(_: FormState, form: FormData): Promise<FormState> {
  const p = centreSchema.safeParse(Object.fromEntries(form))
  if (!p.success) return { error: p.error.issues[0]!.message }
  return run('/admin/centres', `Centre ${p.data.code} created.`, () => tenant(async (db, c) => {
    const d = await db.query<{ code: string }>('select code from districts where id = $1', [p.data.district_id])
    if (!d.rows[0] || !p.data.code.startsWith(d.rows[0].code + '-')) throw new Error('INVALID')
    await db.query('insert into centres (org_id, district_id, code, name, timezone) values ($1,$2,$3,$4,$5)',
      [c.org_id, p.data.district_id, p.data.code, p.data.name, p.data.timezone])
  }))
}

export async function deactivateCentreAction(_: FormState, form: FormData): Promise<FormState> {
  const p = z.object({ centre_id: z.uuid(), reason: z.string().trim().min(3, 'Give a reason') }).safeParse(Object.fromEntries(form))
  if (!p.success) return { error: p.error.issues[0]!.message }
  return run('/admin/centres', 'Centre deactivated. Its users are signed out; all history is preserved.', () =>
    tenant((db) => db.query('select app.deactivate_centre($1,$2)', [p.data.centre_id, p.data.reason])))
}

const userSchema = z.object({
  username: z.string().trim().toLowerCase().regex(/^[a-z0-9._-]{3,40}$/, 'Username: 3-40 of a-z 0-9 . _ -'),
  display_name: z.string().trim().min(2).max(80),
  role: z.enum(['HQ_ADMIN', 'HQ_COUNSELLOR', 'DISTRICT_MANAGER', 'CENTRE_ADMIN', 'COUNSELLOR']),
  centre_id: z.union([z.uuid(), z.literal('')]).optional(), district_id: z.union([z.uuid(), z.literal('')]).optional(),
  password: z.string(),
})
export async function createUserAction(_: FormState, form: FormData): Promise<FormState> {
  const p = userSchema.safeParse(Object.fromEntries(form))
  if (!p.success) return { error: p.error.issues[0]!.message }
  const bad = passwordProblem(p.data.password)
  if (bad) return { error: bad }
  const centreRole = p.data.role === 'CENTRE_ADMIN' || p.data.role === 'COUNSELLOR'
  const hash = await hashPassword(p.data.password)
  return run('/admin/users', `User ${p.data.username} created. They must change this password at first sign-in.`, () =>
    tenant((db, c) => db.query('select app.create_user($1,$2,$3,$4,$5,$6)', [
      p.data.username, p.data.display_name, p.data.role, hash,
      centreRole ? (p.data.centre_id || c.centre_id) : null,
      p.data.role === 'DISTRICT_MANAGER' ? p.data.district_id || null : null])))
}

export async function setUserActiveAction(form: FormData) {
  const p = z.object({ user_id: z.uuid(), active: z.enum(['true', 'false']) }).parse(Object.fromEntries(form))
  await tenant((db) => db.query('select app.set_user_active($1,$2)', [p.user_id, p.active === 'true']))  // failure surfaces in error.tsx
  revalidatePath('/admin/users')
}

export async function changePasswordAction(_: FormState, form: FormData): Promise<FormState> {
  const password = String(form.get('password') ?? '')
  const bad = passwordProblem(password)
  if (bad) return { error: bad }
  if (password !== form.get('confirm')) return { error: 'Passwords do not match.' }
  const hash = await hashPassword(password)
  const r = await run('/', 'Password changed.', () => tenant((db, c) => db.query('select app.set_user_password($1,$2)', [c.user_id, hash])))
  if (r?.ok) redirect('/')
  return r
}
