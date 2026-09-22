# NEEDED.md — what G-TEC must supply before this goes live

Everything below is either a **placeholder value currently in the code/config**, a **credential the code reads from the environment**, or a **business decision the PRD left open**. Each item says where it is used and what happens until it is provided. Fill in the `→` lines and hand this back.

## 1. Credentials and environment (`.env`, see `.env.example`)

| Variable | Used by | Until provided | → Value |
|---|---|---|---|
| `ENCRYPTION_KEY` | every stored secret: Meta page tokens, WhatsApp token, gateway/webhook secrets. Generate: `openssl rand -base64 32` | Meta connect, WhatsApp, payment webhooks and outbound webhooks fail with a clear error | |
| `META_APP_ID`, `META_APP_SECRET` | Meta OAuth (`/integrations`), leadgen + WhatsApp webhook signature checks | "Connect Facebook page" is disabled; webhooks answer 401 | |
| `META_VERIFY_TOKEN` | Meta webhook subscription handshake (any string you choose; paste the same in the Meta app dashboard) | Meta cannot subscribe to `/api/webhooks/meta` and `/api/webhooks/whatsapp` | |
| `APP_URL` | OAuth redirect URI (`<APP_URL>/integrations/meta/callback`), must be whitelisted in the Meta app | derived from the request host | |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`, `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | push notifications (WS-14). Generate: `npx web-push generate-vapid-keys` | in-app alerts work; no push | |
| `CHECKOUT_BASE_URL` | "Payment link" button (DL-7) | defaults to `https://elessons.net/checkout` with placeholder query parameters (see §3) | |
| `EMAIL_*` | automation action `send_email` | queued deliveries are marked failed with `EMAIL_PROVIDER_NOT_CONFIGURED` (visible in System health) — pick a provider (SES / Postmark / SendGrid) and implement `src/lib/email.ts` | |
| `STORAGE_*` (S3-compatible bucket) | documents, voice notes, export files | exports are written to local disk (`EXPORT_DIR`); Documents tab is empty | |
| `DATABASE_URL`, `WORKER_DATABASE_URL`, `MIGRATE_DATABASE_URL` | production Postgres (Supabase or other), three roles: `elessons_app` (no grants), `elessons_worker` (bypass RLS), owner | local trust auth | |

## 2. Meta / WhatsApp approvals (start now — outside engineering control, gates Phases 3 and 5)

- Meta **App Review** for: `pages_show_list`, `pages_read_engagement`, `pages_manage_metadata`, `leads_retrieval`, `pages_manage_ads`, `ads_read`, `business_management`. → status:
- Meta **Business Verification**. → status:
- **WhatsApp Business** account + verified HQ phone number; `phone_number_id` and a permanent system-user token (entered in Integrations → WhatsApp). → :
- Webhook URLs to register in the Meta app: `<APP_URL>/api/webhooks/meta` (field `leadgen`) and `<APP_URL>/api/webhooks/whatsapp` (fields `messages`). → done:
- Meta **dataset (pixel) id** per page for the Conversions API, entered on each connection in Integrations. → :
- Meta **ad account id** per page for spend (Marketing API), same place. → :
- Message **templates** must be approved in Meta Business Manager; record the status and template id in Admin → Templates. Automated template-status sync is not built. → :

**All Meta and WhatsApp code is written to the documented Graph API v21.0 contract and tested only against a mock.** First live test must be done with a real page in a sandbox before any centre is onboarded.

## 3. Website, LMS and checkout (PRD open questions)

- Who controls **elessons.net checkout** and the **student LMS**, and can they call webhooks? → :
- **Payment gateway** in use (Razorpay / Stripe / other). Adapters for `generic`, `razorpay` and `stripe` exist in `src/app/api/webhooks/payment/route.ts`; the vendor's real field names and signature header must be confirmed against their docs. → :
- Checkout must send these fields on payment: `status, amount, currency, payment_id, phone, email, name, student_name, grade, academic_year, access_end_date, ref/coupon, deal_id`. → confirmed:
- **Access end date rule** when the checkout does not send one: PLACEHOLDER = 31 March of the current academic year (`app.record_payment`). → rule:
- **Payment link format** (DL-7): PLACEHOLDER `?ref=<centre>&lead=<id>&payment=<id>&items=<names>`. The real parameters the checkout understands. → :
- Website forms + LMS events post to `/api/webhooks/site` with a bearer key (create it in Integrations → Website forms). Events: `lead` (default), `demo_completed`, `checkout_started`, `checkout_abandoned`, `signup`, `lms_activity`. → integrated:
- Referral: `elessons.net/?ref=<CENTRE-CODE>` must be carried through to the purchase payload as `ref`, and coupons as `coupon`. → :

## 4. Business decisions (each is a setting; placeholders are in place)

| Decision | Where | Placeholder now | → Decision |
|---|---|---|---|
| Calling hours and working days | Admin → Lead configuration | 09:00–20:00, Mon–Sat | |
| Prospecting cadence / max attempts | Admin → Lead configuration | days 0,1,3,7,14,30 (6 attempts) | |
| SLA thresholds | Admin → Lead configuration | 15 working minutes; 24 hours | |
| Cross-centre duplicate policy | Admin → Lead configuration | first touch wins | |
| Can counsellors see all centre leads or only their own | Admin → Centres → Settings (per centre) | own | |
| New leads go to Centre Admin or round-robin | Admin → Centres → Settings (per centre) | Centre Admin | |
| Can centres export their own leads | Admin → Roles & permissions (`leads.export`) | **no** for centre roles | |
| Commission rules and rates | Admin → Payouts | **one sample rule: 10% of revenue** (seed only) | |
| Referral attribution window | Admin → Lead configuration | 30 days, first referral wins | |
| Renewal deal lead time | Admin → Lead configuration | 60 days before access ends | |
| Final list of districts, centres and codes | Admin → Districts / Centres | 5 sample districts, 20 sample centres (`EKM-07` etc.) | |
| The real eLessons catalogue and prices (INR, AED, Gulf currencies, regions) | Catalogue | 2 sample items | |
| Report ratio definitions to match Salesmax: Work Done % = leads with ≥1 attempt / total; Junk % = junk-disposition closes / total; Deal Conversion % = leads with a deal / total; Win % = enrolled / leads with a deal | `src/lib/reports.ts` | as stated | confirm: |
| Lifecycle labels (Enquiry/Prospect/Interested/Dead/Enrolled) | Admin → Lead configuration | Salesmax names | |
| Dispositions list and side effects | Admin → Lead configuration | the 14 from the PRD | |
| 2FA required for which roles | `orgs.require_2fa_roles` | Superadmin, HQ Admin | |

## 5. Salesmax migration (Phase 2 tooling is built; needs the data)

- A **sample export** of Active Leads and Worked Leads with all columns → column names are guessed in Admin → Salesmax import and can be re-mapped there. → file:
- Does the export include **call and note history**? If not, each lead gets one "Migrated from Salesmax" event carrying last disposition and next follow-up. → :
- The **mapping sheet**: 17 users → new usernames (create them first in Admin → Users), 14 teams and 69 pages → centre codes, 89 lists, sources → 4-level tree, dispositions/stages → new names. The import needs an **owner username** and **centre code** column per row (add them to the export with the sheet). → sheet:
- Do Not Track registry export → Admin → Do Not Contact (bulk add is by CSV through the import screen with a `dnc` column: not built; add rows one by one or ask for a bulk tool). → :
- Cutover date outside the admission peak (MG-4). → :

## 6. Legal and operations (launch requirements per PRD §14)

- Legal review against India's DPDP Act and UAE data protection law (parent as data subject, minors' data, consent capture, erasure). Erasure anonymises the lead; free-text notes written before erasure remain in the immutable activity log — confirm whether that is acceptable or note redaction must be designed. → :
- Production hosting choice (Supabase project or other Postgres; Node host for the web app; a long-running host for the worker). → :
- Backups: daily + PITR, RPO/RTO targets, quarterly restore drill owner. Nothing is configured. → :
- Error tracking / uptime monitoring vendor (webhook endpoints need 99.9% availability monitoring). → :
- Product name and domain. → :

## 7. Not built (P2 items; would need their own phase)

Cloud telephony and click-to-call recordings; Android call-logging app and the anti-gaming permission (TE-10); Instagram DM and Messenger; Gmail/Meet/Calendly/Jotform/Google Forms capture; Google Sheets sync; Email-to-lead inbox; Google offline conversions; AI bots and knowledge base (AI-1..5); quotes (DL-11); Deal Mode automatic (DL-5); natural-language quick add (WS-12); offline note/outcome entry; Malayalam/Hindi/Arabic UI strings; custom dashboards (RP-8); template status sync from Meta; DNC bulk import.
