// Thin-stroke icon set, one style, 1.5 px. Kept inline so there is no icon dependency.
const P = (d: string) => function Icon({ className = '' }: { className?: string }) {
  return <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true"><path d={d} /></svg>
}
export const I = {
  dashboard: P('M3 4.5h5.5V10H3zM11.5 4.5H17V7h-5.5zM11.5 10H17v5.5h-5.5zM3 13h5.5v2.5H3z'),
  leads: P('M7.5 9a2.75 2.75 0 1 0 0-5.5 2.75 2.75 0 0 0 0 5.5zM2.5 16.5c0-2.8 2.2-5 5-5s5 2.2 5 5M13 4.5a2.5 2.5 0 0 1 0 4.8M14.5 11.6c1.8.5 3 2 3 4.4'),
  deals: P('M3 6.5h14l-1.2 9H4.2zM7 6.5V5a3 3 0 0 1 6 0v1.5'),
  todos: P('M4 5.5h12M4 10h12M4 14.5h7M15.5 12.5l1.5 1.5 3-3'),
  engagements: P('M3 15.5V9M8 15.5V4.5M13 15.5v-4M18 15.5V7'),
  conversations: P('M3.5 4.5h13v8h-7L6 15.5v-3H3.5z'),
  catalogue: P('M4 4.5h12v11H4zM7 4.5v11M4 8h12'),
  lists: P('M4 5h2M4 10h2M4 15h2M9 5h7M9 10h7M9 15h7'),
  reports: P('M3.5 16.5h13M5 13l3.5-4 3 2.5L15.5 6'),
  exports: P('M10 3.5v9m0 0l3-3m-3 3l-3-3M4 13.5v3h12v-3'),
  integrations: P('M8 3.5v3M12 3.5v3M6 6.5h8v3a4 4 0 0 1-8 0zM10 13.5v3'),
  admin: P('M10 3.5l5.5 3v7L10 16.5l-5.5-3v-7zM10 8a2 2 0 1 0 0 4 2 2 0 0 0 0-4z'),
  users: P('M10 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM4 17c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5'),
  bell: P('M6 13.5h8l-1-1.5V9a3 3 0 0 0-6 0v3zM8.5 16a1.5 1.5 0 0 0 3 0'),
  search: P('M9 14.5a5.5 5.5 0 1 0 0-11 5.5 5.5 0 0 0 0 11zM16.5 16.5l-3.6-3.6'),
  phone: P('M4.5 4.5h3l1.5 3.5-2 1.2a8 8 0 0 0 3.8 3.8l1.2-2 3.5 1.5v3a1 1 0 0 1-1 1A12 12 0 0 1 3.5 5.5a1 1 0 0 1 1-1z'),
  whatsapp: P('M4 16l1-3.2A6.5 6.5 0 1 1 7.5 15zM7.5 7.5c0 3 2 5 5 5'),
  plus: P('M10 4.5v11M4.5 10h11'),
  close: P('M5 5l10 10M15 5L5 15'),
  check: P('M4 10.5l4 4 8-9'),
  chevron: P('M7 5l5 5-5 5'),
  spark: P('M10 3l1.6 4.4L16 9l-4.4 1.6L10 15l-1.6-4.4L4 9l4.4-1.6z'),
  inbox: P('M3.5 11h4l1 2h3l1-2h4M3.5 11l1.5-6h10l1.5 6v5h-13z'),
  clock: P('M10 16.5a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13zM10 6.5V10l2.5 1.5'),
  logout: P('M8 4.5H4.5v11H8M12 13.5l3.5-3.5L12 6.5M15.5 10h-8'),
  alert: P('M10 3.5l7 12.5H3zM10 8v3.5M10 13.5v.5'),
  sliders: P('M4 6h12M4 10h12M4 14h12M8 4.5v3M13 8.5v3M6.5 12.5v3'),
}
