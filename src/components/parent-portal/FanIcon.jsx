export function FanIcon({ name = 'fans' }) {
  const paths = {
    fans: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M16 3a4 4 0 0 1 0 8M22 21v-2a4 4 0 0 0-3-3.87',
    invite: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M19 7v6M16 10h6',
    schedule: 'M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14H3V6a2 2 0 0 1 2-2M7 14h3M14 14h3M7 18h3',
    game_day: 'm12 7 5 4-2 6H9l-2-6 5-4M12 7V2M17 11l5-1M15 17l3 4M9 17l-3 4M7 11l-5-1',
    development: 'M3 20h18M5 16l5-5 4 3 6-9M15 5h5v5',
    resources: 'M3 5h7l2 3h9v12H3V5',
    email: 'M3 5h18v14H3V5m0 0 9 8 9-8',
    qr: 'M3 3h6v6H3V3M15 3h6v6h-6V3M3 15h6v6H3v-6M15 15h3v3h3v3h-6v-6',
    share: 'M12 16V3m-5 5 5-5 5 5M5 12v9h14v-9',
    remove: 'M4 7h16M9 3h6l1 4H8l1-4M6 7l1 14h10l1-14M10 11v6M14 11v6',
  }
  return <svg aria-hidden="true" width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d={paths[name] || paths.fans} />{['fans', 'invite'].includes(name) ? <circle cx="9" cy="7" r="4" /> : name === 'game_day' ? <circle cx="12" cy="12" r="10" /> : null}</svg>
}
