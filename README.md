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
## Test accounts (development seed only)

Every seeded account uses the same password: **`dev-only-password-1`** (change with `SEED_PASSWORD` before running `pnpm db:seed`). These accounts exist only in the dev/test databases; the seed refuses to run anywhere else.

**HQ** — leave the centre code blank on the sign-in page. HQ Admin and Superadmin are asked to set up 2FA on first sign-in (scan the QR with any authenticator app).

| Role | Centre code | Username | Password |
|---|---|---|---|
| Superadmin | *(blank)* | `superadmin` | `dev-only-password-1` |
| HQ Admin | *(blank)* | `hqadmin` | `dev-only-password-1` |
| HQ Counsellor | *(blank)* | `hqcounsellor` | `dev-only-password-1` |

**District Managers** — type the district code in the centre-code field.

| District | Centre code field | Username | Password |
|---|---|---|---|
| Ernakulam | `EKM` | `manager` | `dev-only-password-1` |
| Kozhikode | `KKD` | `manager` | `dev-only-password-1` |
| Thiruvananthapuram | `TVM` | `manager` | `dev-only-password-1` |
| Thrissur | `TSR` | `manager` | `dev-only-password-1` |
| Dubai | `DXB` | `manager` | `dev-only-password-1` |

**Centres** — every one of the 20 seeded centres has the same three accounts. Centre codes: `EKM-01`…`EKM-08`, `KKD-01`…`KKD-04`, `TVM-01`…`TVM-03`, `TSR-01`…`TSR-03`, `DXB-01`, `DXB-02`. Sample leads are seeded in `EKM-07`, `EKM-01`, `KKD-03` and `DXB-01`.

| Role | Centre code | Username | Password |
|---|---|---|---|
| Centre Admin | e.g. `EKM-07` | `admin` | `dev-only-password-1` |
| Counsellor 1 | e.g. `EKM-07` | `counsellor1` | `dev-only-password-1` |
| Counsellor 2 | e.g. `EKM-07` | `counsellor2` | `dev-only-password-1` |

`EKM-07` is set to round-robin new leads between its two counsellors; every other centre sends new leads to its Centre Admin.

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
