export function StatusPill({ status }) {
  const isSuspended = status === 'suspended'

  return (
    <span
      className={[
        'inline-flex w-fit shrink-0 whitespace-nowrap rounded-lg border px-3 py-1.5 text-center text-xs font-semibold uppercase leading-none tracking-[0.08em]',
        isSuspended
          ? 'border-red-200 bg-red-50 text-red-800'
          : 'border-[#bfdbfe] bg-[#eff6ff] text-[#1d4ed8]',
      ].join(' ')}
    >
      {isSuspended ? 'Suspended' : 'Active'}
    </span>
  )
}
