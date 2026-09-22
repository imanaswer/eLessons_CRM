# Migration from Salesmax

Tooling is built (Admin → Salesmax import) and tested with synthetic rows; **the real Salesmax column names are unknown** until a sample export arrives (NEEDED.md §5).

1. **Extract** Active Leads and Worked Leads exports with all columns; DNC registry; deals/tags/lists if exportable.
2. **Map**: add two columns to each export from the mapping sheet — `owner_username` (new CRM username) and `centre_code` — or map existing team/page columns to them on the import screen. Create the users first (Admin → Users).
3. **Import**: upload; map columns (the Salesmax lead id is the dedupe key, so re-running the same file creates nothing); start. Rows pass through the ingestion gate: phones normalised, duplicates and DNC reported. Each lead keeps its created date, owner, source, lifecycle, last disposition and next follow-up, plus one "Migrated from Salesmax" event.
4. **Verify**: the reconciliation table on the batch page shows Salesmax rows vs CRM leads by lifecycle, source, owner and centre, and the outcome breakdown (created / duplicate / dnc / invalid). Spot-check 100 leads by hand.
5. **Parallel run** for two weeks: Meta pages connected here; Salesmax read-only.
6. **Cut over** outside the admission peak; WhatsApp last.
