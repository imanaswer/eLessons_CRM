# eLessons CRM

Multi-tenant CRM for G-TEC eLessons, replacing Salesmax. Spec: `eLessons CRM Product Requirements Document.pdf`.
One Next.js app + one Postgres database (+ one worker from Phase 1). Centre isolation is enforced by Postgres RLS.

**Status: all six phases built and tested locally (89 tests). Nothing is deployed and nothing has been run against live Meta, WhatsApp or a payment gateway.** What G-TEC must supply is in [NEEDED.md](NEEDED.md); the itemised status is in [ROADMAP.md](ROADMAP.md).

## Local setup
Needs Node >= 23.6, pnpm, PostgreSQL 15+ running locally.
```sh
pnpm install
createdb elessons_dev && createdb elessons_test
cp .env.example .env            # local trust auth works with the defaults
pnpm db:migrate && pnpm db:seed
pnpm test                       # 89 tests: isolation, ingestion, engine, integrations (mocked Meta/WhatsApp), must be green
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

Docs: [NEEDED](NEEDED.md) · [ARCHITECTURE](ARCHITECTURE.md) · [DATABASE](DATABASE.md) · [SECURITY](SECURITY.md) · [TESTING](TESTING.md) · [DEPLOYMENT](DEPLOYMENT.md) · [INTEGRATIONS](INTEGRATIONS.md) · [MIGRATION](MIGRATION.md) · [ROADMAP](ROADMAP.md)

## Webhook endpoints
| Endpoint | Auth | Purpose |
|---|---|---|
| `GET/POST /api/webhooks/meta` | X-Hub-Signature-256 (app secret) | Lead Ads leadgen |
| `GET/POST /api/webhooks/whatsapp` | X-Hub-Signature-256 | messages + delivery statuses |
| `POST /api/webhooks/payment?gateway=generic|razorpay|stripe` | X-Signature = HMAC-SHA256(raw body, connection secret) | payment events |
| `POST /api/webhooks/site` | Bearer API key | website forms, LMS events |
| `POST /api/v1/leads` | Bearer API key | generic lead API |

Every endpoint verifies, stores the raw event, and returns; the worker processes it. Bodies over 1 MB are rejected (413).

## Troubleshooting
- HQ Admin / Superadmin are asked for 2FA on every new session (TEN-9). Seed accounts set it up on first login with any authenticator app.
- Import stuck on "running" or export stuck on "queued": the worker isn't running (`pnpm worker`).
- `permission denied for table …` from the app: expected if you query outside `withTenant()`. The login role has no table grants by design.
- Every page empty after login: `DATABASE_URL` points at a DB that was migrated but not seeded, or the user's centre/district is deactivated.
- Tests pass suspiciously after a policy change: confirm the first test (`genuinely unprivileged`) ran. A superuser connection bypasses RLS.
