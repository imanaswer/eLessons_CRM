# Security

Priority order: security > data integrity > business correctness > UX.

## Tenant isolation
- Boundary = PostgreSQL RLS. Frontend filtering is never relied on; pages run plain `select … from centres` and the database narrows it.
- The web app's DB role `elessons_app`: `LOGIN NOINHERIT`, no superuser, no `BYPASSRLS`, owns nothing, has **zero table grants**. It can only (a) call `app.auth_*` and (b) `SET LOCAL ROLE authenticated` inside `withTenant()`.
- Claims are set server-side from the session row. Missing claims evaluate to NULL → policies are false → zero rows (default deny, tested).
- `elessons_worker` (BYPASSRLS) is the single exempt principal; its credentials must never be given to the web app.
- **Deploy check:** `select rolsuper, rolbypassrls from pg_roles where rolname = 'elessons_app'` must be `f, f`. The test suite asserts this first.

## Threat model (read before changing `lead_list`)
The tenant DB role's identity is a transaction-local setting (`request.jwt.claims`) written by the app server, the same model PostgREST and Supabase use. Consequences:
- The isolation guarantee is: **no code path can return another centre's rows, whatever the user sends.** Users never send SQL; every filter is whitelisted by zod and bound as a parameter (`src/lib/leads-query.ts`).
- It is **not** a defence against SQL injection: injected SQL running as `authenticated` could set HQ claims. So injection must stay impossible: no string-built SQL from input, ever. `grep -n '\${' src/lib/leads-query.ts` should only show parameter placeholders and whitelisted constants.
- That is why `lead_list` carries no `security_barrier`: the barrier guards against hostile SQL the role could already escalate with, and it cost a 600x slowdown.
- `elessons_worker` bypasses RLS. It accepts raw payloads but never executes them, and drops to the requester's scope for exports.

## Leads (Phase 1)
- No app role can SELECT, INSERT, UPDATE or DELETE `leads`, `lead_phones` or `parent_identities`. Tested with HQ Admin claims, the most privileged tenant identity.
- Write functions answer `LEAD_NOT_FOUND` for leads outside the caller's scope, so existence is never confirmed.
- Cross-centre conflicts and the custody chain (`transfers`) are invisible to centres. The "transferred in" activity deliberately omits where the lead came from.
- Raw inbound payloads are readable by admins of the owning scope only, never by counsellors.
- Phone search by digits is refused for users who only see masked phones (no digit-by-digit probing).
- Exports: permission checked at request **and** at run time; file served only to the requester; CSV cells are neutralised against formula injection.
- Erasure limits, stated plainly: activity rows are immutable, so free-text notes written before erasure remain in the log attached to a nameless, phoneless lead. If legal review requires note redaction, that needs a designed exception to append-only.

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

## Phases 3-6
- **2FA**: TOTP (RFC 6238) required for roles in `orgs.require_2fa_roles`; enforced by `requireClaims()` before any page or tenant query; secret AES-256-GCM encrypted; verified once per session.
- **Secrets at rest**: `ENCRYPTION_KEY` (AES-256-GCM, versioned `v1.` blobs). Page tokens, WhatsApp tokens, gateway and webhook secrets. `secret_enc` has no SELECT grant for any tenant role; only `app.connection_secret()` (scope-checked) and the worker read it.
- **Webhooks**: Meta/WhatsApp `X-Hub-Signature-256` over the raw body with the app secret; payment `X-Signature` HMAC with the per-connection secret; site/API bearer keys stored as SHA-256. Unsigned → 401 before anything is stored. 1 MB body limit. Handlers call one definer function and return.
- **Unmapped pages**: a validly signed event for a page no centre has connected is kept as dead-letter with `MAPPING_PENDING`, never dropped, replayable by HQ.
- **Outbound**: webhooks are https only, signed with `x-elessons-signature`, 10 s timeout, 6 retries then dead. The worker never executes payload content.
- **Conversions API** sends only the parent's SHA-256 phone/email; no student field leaves the system (PRD s14 minors).
- **WhatsApp**: DNC, opt-out (`STOP`) and withdrawn consent are checked in `app.queue_message` before any message is queued, for users, automation and broadcasts alike.
- **Automation**: rules are rows scoped org/district/centre; centres cannot edit or disable HQ rules (policy). Actions run inside the worker under `security definer` with no user input reaching SQL.
- **Merge** is restricted to the same centre and to HQ Admin / Centre Admin with `leads.merge`.

## Not yet implemented — must not be claimed
| Item | PRD | Note |
|---|---|---|
| Per-IP rate limiting (login and webhooks) | s5 | per-account lockout exists; add at the edge/WAF |
| Live verification of Meta / WhatsApp / gateway signatures | s5 | verified against the documented formats and self-generated signatures only |
| Device/session list UI | s14 | data is in `sessions` |
| Block bulk select-all | TEN-8 | hides the select-all checkbox only; bulk functions still accept many ids |
| DPDP / UAE legal review, consent, erasure | s14 | launch blocker, not an engineering task alone |
| Backups, PITR, restore test | s46 | nothing configured or verified |
