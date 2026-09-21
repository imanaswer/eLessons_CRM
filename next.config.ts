import type { NextConfig } from 'next'

const config: NextConfig = {
  serverExternalPackages: ['pg'],
  poweredByHeader: false,
  experimental: { serverActions: { bodySizeLimit: '12mb' } },   // bulk upload files (10 MB cap enforced in the action)
  async headers() {
    return [{
      source: '/:path*',
      headers: [
        { key: 'X-Frame-Options', value: 'DENY' },
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'Referrer-Policy', value: 'same-origin' },
        { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
      ],
    }]
  },
}
export default config
