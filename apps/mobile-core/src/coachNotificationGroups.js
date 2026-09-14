export function groupCoachNotifications(items, now = new Date()) {
  const week = new Date(now).getTime() - 7 * 86400000
  const month = new Date(now)
  month.setMonth(month.getMonth() - 1)
  const quarter = new Date(now)
  quarter.setMonth(quarter.getMonth() - 3)
  const groups = [
    { id: 'recent', title: 'Last 7 days', items: [] },
    { id: 'week', title: 'Older than 7 days', items: [] },
    { id: 'month', title: 'Older than 1 month', items: [] },
    { id: 'archive', title: 'Archive: older than 3 months', items: [] },
  ]
  for (const item of [...items].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))) {
    const time = Date.parse(item.created_at)
    const index = !Number.isFinite(time) || time >= week ? 0 : time >= month.getTime() ? 1 : time >= quarter.getTime() ? 2 : 3
    groups[index].items.push(item)
  }
  return groups.filter(group => group.items.length)
}
