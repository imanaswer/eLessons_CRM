# Integrations

Nothing is implemented yet (Phase 3+). Fixed design: every connector = Connect / Receive / Map / Health; every payload lands in `inbound_events` before processing; see ARCHITECTURE.md "Planned".

**Action for G-TEC now, independent of code (PRD s9 dependency):** submit Meta app review (`leads_retrieval`, `pages_show_list`, `pages_manage_metadata`, `pages_read_engagement`, `ads_read`) and Meta business verification, and start WhatsApp Business verification. Approval time is outside engineering control and gates Phase 3 and 5.

Unanswered and blocking Phase 3/4: who controls elessons.net checkout and the LMS, can they emit webhooks, which payment gateway.
