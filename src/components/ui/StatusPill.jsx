export function StatusPill({ status }) {
  const isSuspended = status === 'suspended'
  const isArchived = status === 'archived'
  const label = isArchived ? 'Archived' : isSuspended ? 'Suspended' : 'Active'
  const toneClass = isArchived
    ? 'border-[#fecdca] bg-[#fff1f3] text-[#b42318]'
    : isSuspended
      ? 'border-red-200 bg-red-50 text-red-800'
      : 'border-[#bbf7d0] bg-[#ecfdf5] text-[#065f46]'

  return (
    <span
      className={[
        'inline-flex w-fit shrink-0 whitespace-nowrap rounded-lg border px-3 py-1.5 text-center text-xs font-semibold uppercase leading-none tracking-[0.08em]',
        toneClass,
      ].join(' ')}
    >
      {label}
    </span>
  )
}
