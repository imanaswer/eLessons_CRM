'use client'
import { I } from '@/components/icons.tsx'
export default function AppError({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="panel mx-auto mt-10 max-w-md p-8 text-center">
      <span className="mx-auto mb-3 inline-flex h-10 w-10 items-center justify-center rounded-full bg-danger-soft text-danger"><I.alert className="h-5 w-5" /></span>
      <h2 className="text-[15px] font-semibold">That didn&apos;t work</h2>
      <p className="mt-1 text-[13px] text-muted">You may not have permission for this action, or the record changed underneath you. Nothing was saved.</p>
      <button className="btn btn-quiet mt-5" onClick={reset}>Try again</button>
    </div>
  )
}
