# eLessons CRM

Multi-tenant CRM for G-TEC eLessons, replacing Salesmax. Spec: `eLessons CRM Product Requirements Document.pdf`.
One Next.js app + one Postgres database (+ one worker from Phase 1). Centre isolation is enforced by Postgres RLS.

**Status: Phase 0 (foundation) and Phase 1 (lead tracking core) complete. Phases 2-6 not started.** See [ROADMAP.md](ROADMAP.md) and [PHASE-1.md](PHASE-1.md).

## Local setup
Needs Node >= 23.6, pnpm, PostgreSQL 15+ running locally.
```sh
pnpm install
createdb elessons_dev && createdb elessons_test
cp .env.example .env            # local trust auth works with the defaults
pnpm db:migrate && pnpm db:seed
pnpm test                       # 54 isolation / ingestion / lifecycle / custody tests, must be green
pnpm dev                        # web app
pnpm worker                     # background worker (imports, inbound events, exports) in a second terminal
```
Seed logins (password = `SEED_PASSWORD`, default `dev-only-password-1`):
| Who | Centre code | Username |
|---|---|---|
| Centre Admin | `EKM-07` | `admin` |
| Counsellor | `EKM-07` | `counsellor1` |
| District Manager | `EKM` | `manager` |
| HQ Admin | *(blank)* | `hqadmin` |
| Superadmin | *(blank)* | `superadmin` |

Docs: [ARCHITECTURE](ARCHITECTURE.md) · [DATABASE](DATABASE.md) · [SECURITY](SECURITY.md) · [TESTING](TESTING.md) · [DEPLOYMENT](DEPLOYMENT.md) · [INTEGRATIONS](INTEGRATIONS.md) · [MIGRATION](MIGRATION.md) · [ROADMAP](ROADMAP.md)

## Troubleshooting
- Import stuck on "running" or export stuck on "queued": the worker isn't running (`pnpm worker`).
- `permission denied for table …` from the app: expected if you query outside `withTenant()`. The login role has no table grants by design.
- Every page empty after login: `DATABASE_URL` points at a DB that was migrated but not seeded, or the user's centre/district is deactivated.
- Tests pass suspiciously after a policy change: confirm the first test (`genuinely unprivileged`) ran. A superuser connection bypasses RLS.
