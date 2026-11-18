export function AdultCalendarResponses({ invites = [] }) {
  const adultInvites = invites.filter(invite => invite.calendarEventId
    && ['player', 'parent_and_player'].includes(invite.recipientType))
  if (!adultInvites.length) return null
  const labels = { available: 'Attending', maybe: 'Maybe', unavailable: 'Not attending' }
  return (
    <section className="mt-4" aria-label="Adult Player responses">
      <h4 className="text-sm font-black text-[#101828]">Player responses</h4>
      <ul className="mt-2">
        {adultInvites.map(invite => (
          <li key={invite.id} className="flex justify-between gap-3 border-b border-[#d7e5dc] py-3 text-sm">
            <span className="font-bold text-[#101828]">{invite.player?.playerName || 'Player'}</span>
            <span className="font-black text-[#047857]">{labels[invite.adultResponseState] || 'Awaiting response'}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}
