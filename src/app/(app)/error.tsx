'use client'
export default function AppError({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="panel mx-auto mt-10 max-w-md p-6 text-center">
      <h2 className="font-semibold">That didn&apos;t work</h2>
      <p className="mt-1 text-sm text-muted">You may not have permission for this action, or the record changed. Nothing was saved.</p>
      <button className="btn btn-quiet mt-4" onClick={reset}>Try again</button>
    </div>
  )
}
