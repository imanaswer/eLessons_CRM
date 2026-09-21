# Security

Priority order: security > data integrity > business correctness > UX.

## Tenant isolation
- Boundary = PostgreSQL RLS. Frontend filtering is never relied on; pages run plain `select … from centres` and the database narrows it.
- The web app's DB role `elessons_app`: `LOGIN NOINHERIT`, no superuser, no `BYPASSRLS`, owns nothing, has **zero table grants**. It can only (a) call `app.auth_*` and (b) `SET LOCAL ROLE authenticated` inside `withTenant()`.
- Claims are set server-side from the session row. Missing claims evaluate to NULL → policies are false → zero rows (default deny, tested).
- `elessons_worker` (BYPASSRLS) is the single exempt principal; its credentials must never be given to the web app.
- **Deploy check:** `select rolsuper, rolbypassrls from pg_roles where rolname = 'elessons_app'` must be `f, f`. The test suite asserts this first.

## Authentication
- Centre code + username + password; HQ without code. Same error for wrong code/username/password; dummy hash burned for unknown users (timing).
- scrypt N=32768 with per-password salt and stored parameters. Minimum 10 chars. Temporary passwords force a change prompt.
- Lockout: `orgs.max_failed_logins` (5) / `lockout_minutes` (15). Session length `orgs.session_hours` (12). All data, not code.
- Session cookie: 32 random bytes, `HttpOnly`, `SameSite=Lax`, `Secure` in production; only its SHA-256 is stored.
- Disable user / deactivate centre / password reset revoke sessions; effective on the next request.
- CSRF: all mutations are Next.js server actions (Origin/Host check) + SameSite cookie. Headers: `X-Frame-Options: DENY`, `nosniff`, HSTS.

## Authorization
Role scope (`app.can_see`) × permission (`app.has_perm`). Centre Admins can create/disable only `COUNSELLOR`s in their own centre; nobody can change their own active flag; only Superadmin edits the matrix. `password_hash`, `totp_secret_enc`, lockout state and `sessions` are not selectable by any tenant role, including HQ.

## Audit
`audit_log` rejects UPDATE/DELETE/TRUNCATE by trigger, even from the owner. Actor and scope are taken from claims, never from arguments. Logged now: login, failed login, logout, user create/disable/role change, password change/reset, district/centre create/edit, centre deactivation, permission changes, impersonation start/end. Retention target 2 years (PRD s14) — no purge job exists, so nothing is removed.

## Not yet implemented — must not be claimed
| Item | PRD | Note |
|---|---|---|
| 2FA (TOTP) for Superadmin/HQ Admin | TEN-9, P1 | columns reserved; **required before production HQ use** |
| Per-IP login rate limiting | s5 | per-account lockout exists; add at the edge/WAF |
| Device/session list UI | s14 | data is in `sessions` |
| Token encryption (`ENCRYPTION_KEY`) | s13 | arrives with `connections` in Phase 3 |
| Privacy toggles (phone masking etc.) | TEN-8 | permission keys seeded; enforced when `leads` exists |
| DPDP / UAE legal review, consent, erasure | s14 | launch blocker, not an engineering task alone |
| Backups, PITR, restore test | s46 | nothing configured or verified |
