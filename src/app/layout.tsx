import type { Metadata, Viewport } from 'next'
import './globals.css'

export const metadata: Metadata = { title: 'eLessons CRM', manifest: '/manifest.webmanifest' }
export const viewport: Viewport = { themeColor: '#1f4fd8', width: 'device-width', initialScale: 1 }

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-dvh font-sans antialiased">{children}</body>
    </html>
  )
}
