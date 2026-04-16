const statusStyles = {
  Approved: 'bg-[#e5efe2] text-[#46604a]',
  Pending: 'bg-[#f4efe4] text-[#7b6238]',
  Rejected: 'bg-[#f3e5e5] text-[#8b4b4b]',
}

export function StatusBadge({ status }) {
  const className = statusStyles[status] ?? 'bg-[#eef1ec] text-slate-700'

  return <span className={`rounded-full px-3 py-1 text-xs font-semibold ${className}`}>{status}</span>
}
