# Design system

Operate-mode product UI: the tool should disappear into the task. Brand lives in precise details, not decoration. Everything below is in `src/app/globals.css` (`@theme` tokens + `@layer components`) and `src/components/ui.tsx`.

## Type
Geist (via `next/font`), Geist Mono for ids/keys. Body 14px / 1.45, tabular numerals on by default. Scale: page title 22/600, panel head 13/600, body 13, table header 11/600 uppercase +0.06em, meta 12–11.5. Headings track -0.015em; big numbers -0.02em.

## Color
One cool-tinted neutral family (`canvas #f4f5f8`, `rail #eef0f4`, `surface #fff`, `sunken`, `line`, `ink`, `ink-2`, `muted`, `faint`). One accent: `brand #3557d6` (primary actions, current selection, focus ring, links). Semantic: `ok`, `warn`, `danger`, `info`, each with a `-soft` tint used for chips and banners. Lifecycle: Enquiry = brand, Prospect = warn, Interested/Enrolled = ok, Dead = muted.

## Surfaces and elevation
Declared once per surface. Resting panels: `.panel` = white + 1px hairline ring, no shadow. Floating things (drawer, command palette, menus): `.float` = ring + tinted diffused shadow. Radii: controls 8, panels 12, floats 14. Avatars are squircles (30%) coloured deterministically from the name.

## Controls
`.btn` (+ `-primary`, `-quiet`, `-danger`, `-ghost`): 36px, press scales to 0.97, 150ms exponential ease-out; `.input` with hover, focus ring and inset shadow; `.seg` pills for views/tabs (`aria-current="page"` = selected); `.chip` tonal badges, `.chip-dot` adds a status dot; `.nav-item` with `aria-current`.

## Motion
Only state changes animate: drawer slides in (280ms, drawer curve), popovers scale from 0.97, buttons press. No page-load choreography. Keyboard actions (⌘K) open instantly. `prefers-reduced-motion` collapses everything.

## Patterns
- Every number on a dashboard or report is a link to the lead list behind it (`Stat`).
- Empty states teach (`Empty`: icon, title, hint, action).
- Loading is a skeleton in the page's shape (`loading.tsx`).
- Phones are formatted `+91 98950 10143`; system-set vs user-set follow-ups are a hollow vs filled dot.
- On phones the lead drawer puts the outcome form first: Call → outcome → Save is three taps on one screen.
