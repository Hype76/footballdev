const statusStyles = {
  Approved: 'bg-[#183521] text-[#bef264]',
  Pending: 'bg-[#3b2f12] text-[#facc15]',
  Submitted: 'bg-[#172c38] text-[#7dd3fc]',
  Rejected: 'bg-[#3f1f24] text-[#fda4af]',
}

export function StatusBadge({ status }) {
  const className = statusStyles[status] ?? 'bg-[var(--panel-soft)] text-[var(--text-primary)]'

  return <span className={`rounded-full px-3 py-1 text-xs font-semibold ${className}`}>{status}</span>
}
