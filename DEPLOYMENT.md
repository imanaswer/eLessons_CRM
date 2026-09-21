# Deployment

Not deployed anywhere yet. This is the intended procedure; none of it has been executed against a hosted environment.

1. Create a Supabase project (Postgres + Storage). Auth product unused (see ARCHITECTURE.md #3).
2. As `postgres`: `alter role elessons_app password '…'; alter role elessons_worker password '…';` after the first migration creates them.
3. `MIGRATE_DATABASE_URL=<postgres role, direct connection> pnpm db:migrate`. Do **not** run `db:seed` (it refuses non-dev names anyway). Create the org and first Superadmin with a one-off SQL script.
4. App env: `DATABASE_URL` = `elessons_app` credentials via the **session-mode** pooler or direct connection. Transaction-mode pooling is also safe because role and claims are `SET LOCAL` inside one transaction.
5. Run `pnpm test` in CI against a scratch database before every deploy.
6. Host the Next.js app on any Node runtime. Run `pnpm worker` as a long-running process (not serverless) with `WORKER_DATABASE_URL`; several instances may run side by side.
7. Exports are written to `EXPORT_DIR` on local disk, so **today the web app and the worker must share a filesystem**. Moving this to object storage is required before hosting them separately.

## Backups
**Nothing is configured and nothing has been verified.** Target: Supabase daily backups + PITR, RPO ≤ 5 min, RTO ≤ 4 h, quarterly restore drill recorded here with date and result.

## Observability
Currently: JSON error lines to stdout from `src/lib/errors.ts`. Error tracking, uptime checks and webhook health arrive with the webhook endpoints (Phase 1/3).
