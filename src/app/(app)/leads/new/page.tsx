import { randomUUID } from 'node:crypto'
import { tenant } from '@/lib/session.ts'
import { NewLeadForm } from './form.tsx'

export default async function NewLead() {
  const d = await tenant(async (db, c) => ({
    country: (await db.query<{ c: string }>("select coalesce((select default_country from centres where id = app.centre_id()), 'IN') as c")).rows[0]!.c,
    centres: c.centre_id ? [] : (await db.query<{ id: string; code: string }>('select id, code from centres where is_active and accepts_inbound order by code')).rows,
    hq: c.centre_id === null && c.district_id === null,
  }))
  // one key per rendered form: a double-submit or a retry after a timeout cannot create two leads
  return <NewLeadForm country={d.country} centres={d.centres} allowPool={d.hq} idempotencyKey={randomUUID()} />
}
