// Raw payload -> the normalised lead the SQL gate accepts. Pure: no I/O, so it is trivially testable
// and identical for manual entry, bulk rows and (later) every connector.
import { parsePhoneNumberFromString, type CountryCode } from 'libphonenumber-js/max'

export type NormalisedLead = {
  phone: string; name?: string; email?: string; country?: string; state?: string; city?: string; timezone?: string; language?: string
  students?: { name: string; grade?: string; stream?: string; school?: string; board?: string; subjects?: string[] }[]
  source?: { l1?: string; l2?: string; l3?: string; l4?: string }
  consent?: { status: 'granted' | 'denied' | 'unknown'; source?: string; evidence?: Record<string, unknown> }
  owner_user_id?: string; list_id?: string; repeat_enquiry?: boolean; tags?: string[]; referral_code?: string
}

// India and the Gulf are first-class (LT-2): used for the lead's follow-up timezone (TE-5).
const TZ: Record<string, string> = {
  IN: 'Asia/Kolkata', AE: 'Asia/Dubai', SA: 'Asia/Riyadh', QA: 'Asia/Qatar', KW: 'Asia/Kuwait', OM: 'Asia/Muscat', BH: 'Asia/Bahrain',
}

export function normalisePhone(input: string, defaultCountry: string): { e164: string; country: string } | null {
  const cleaned = String(input ?? '').replace(/[^\d+]/g, '').replace(/^00/, '+')
  const p = parsePhoneNumberFromString(cleaned, defaultCountry as CountryCode)
  if (!p?.isValid() || !p.country) return null
  return { e164: p.number, country: p.country }
}

const str = (v: unknown) => (v == null ? undefined : String(v).trim() || undefined)

export function normaliseLead(raw: Record<string, unknown>, defaultCountry: string, centreTimezone: string): NormalisedLead | null {
  const phone = normalisePhone(String(raw.phone ?? ''), defaultCountry)
  if (!phone) return null
  const email = str(raw.email)?.toLowerCase()
  const students = Array.isArray(raw.students) ? raw.students : raw.student_name ? [{ name: raw.student_name, grade: raw.grade, stream: raw.stream, school: raw.school, board: raw.board }] : []
  return {
    ...(raw as Partial<NormalisedLead>),
    phone: phone.e164, country: phone.country, timezone: TZ[phone.country] ?? centreTimezone,
    name: str(raw.name), email: email && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) ? email : undefined,
    state: str(raw.state), city: str(raw.city), language: str(raw.language),
    students: students.map((s) => ({ ...s, name: str(s.name) ?? '', grade: str(s.grade)?.replace(/\D/g, '') })).filter((s) => s.name),
  }
}

// Bulk rows: apply the user's column mapping ({ field: header }) before normalising.
export function applyMapping(row: Record<string, unknown>, mapping: Record<string, string>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(mapping).filter(([, header]) => header).map(([field, header]) => [field, row[header]]))
}
