export function StatusPill({ status }) {
  const isSuspended = status === 'suspended'

  return (
    <span
      className={[
        'inline-flex w-fit rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em]',
        isSuspended
          ? 'bg-red-500/15 text-red-300'
          : 'bg-[var(--button-primary)] text-[var(--button-primary-text)]',
      ].join(' ')}
    >
      {isSuspended ? 'Suspended' : 'Active'}
    </span>
  )
}
