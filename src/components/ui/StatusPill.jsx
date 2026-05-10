export function StatusPill({ status }) {
  const isSuspended = status === 'suspended'

  return (
    <span
      className={[
        'inline-flex w-fit shrink-0 whitespace-nowrap rounded-full px-3 py-1.5 text-center text-xs font-semibold uppercase leading-none tracking-[0.08em]',
        isSuspended
          ? 'bg-red-500/15 text-red-300'
          : 'bg-[var(--button-primary)] text-[var(--button-primary-text)]',
      ].join(' ')}
    >
      {isSuspended ? 'Suspended' : 'Active'}
    </span>
  )
}
