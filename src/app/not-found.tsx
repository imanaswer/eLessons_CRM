import Link from 'next/link'
export default function NotFound() {
  return <main className="grid min-h-dvh place-items-center px-4"><div className="float max-w-sm p-8 text-center"><p className="num text-[40px] font-semibold tracking-[-0.03em] text-faint">404</p><h1 className="text-[15px] font-semibold">This page doesn&apos;t exist</h1><p className="mt-1 text-[13px] text-muted">The link may be old, or the record was moved to another centre.</p><Link href="/" className="btn btn-primary mt-5">Go to dashboard</Link></div></main>
}
