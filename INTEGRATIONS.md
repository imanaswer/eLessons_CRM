# Integrations

Connector = Connect / Receive / Map / Health (PRD s9). Every inbound payload is stored in `inbound_events` before processing; every connection reports one of the eight health states; HQ sees all connections, a centre only its own.

| Connector | Status | Notes |
|---|---|---|
| Meta Lead Ads per centre | built, **mock-tested only** | Centre Admin: Integrations → Connect Facebook page → OAuth → pick page → forms sync + leadgen subscription. Page → centre mapping is the routing. Leads carry page/form/campaign/ad ids and the 4-level source. Token expiry → Reconnect ≥ 7 days ahead. |
| Meta Marketing API (spend) | built, mock-tested | needs `ad_account_id` on the connection; synced every 6 h; joined by (centre, campaign id) into the Campaign report and dashboard. |
| Meta Conversions API | built, mock-tested | Interested / Enrolled per enquiry cycle, hashed parent identifiers only; needs `pixel_id`. |
| WhatsApp Cloud API | built, mock-tested | HQ number first (CV-8 centre numbers: data model ready, no UI flow). Inbound → lead via the gate; STOP → opt-out; 24 h window; templates; broadcasts; delivery statuses. |
| Website forms + LMS events | built | `/api/webhooks/site`, bearer key. Referral `ref`/`coupon`. |
| Payment gateway | built, gateway unknown | `/api/webhooks/payment?gateway=` with adapters `generic`, `razorpay`, `stripe` (field names unverified against vendor docs). |
| Generic API | built | `/api/v1/leads`, bearer key, idempotency key. |
| Google Ads lead forms | built (as a keyed webhook) | create a `google_ads` connection; POST the form payload with the key. |
| Outbound webhooks | built | signed, retried, dead-lettered. |
| Email sending | **not built** | provider not chosen (NEEDED.md). |
| Google Sheets, email-to-lead, Google offline conversions, Instagram/Messenger, telephony, Gmail/Meet/Calendly/Jotform/Forms | not built | P2 |

Setup steps, credentials and approvals: NEEDED.md §1-3.
