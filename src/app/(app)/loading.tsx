// Skeleton that matches the page shape: title, a stat strip, a table.
export default function Loading() {
  return <div className="space-y-5" aria-busy="true" aria-label="Loading">
    <div className="skeleton h-7 w-48" />
    <div className="panel grid grid-cols-2 gap-px overflow-hidden sm:grid-cols-4 lg:grid-cols-7">{Array.from({ length: 7 }, (_, i) => <div key={i} className="space-y-2 p-4"><div className="skeleton h-3 w-16" /><div className="skeleton h-6 w-12" /></div>)}</div>
    <div className="panel divide-y divide-line">{Array.from({ length: 8 }, (_, i) => <div key={i} className="flex items-center gap-4 px-4 py-3"><div className="skeleton h-8 w-8 rounded-[30%]" /><div className="skeleton h-3.5 w-40" /><div className="skeleton h-5 w-20" /><div className="ml-auto skeleton h-3.5 w-24" /></div>)}</div>
  </div>
}
