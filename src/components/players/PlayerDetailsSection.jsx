import {
  EVALUATION_SECTIONS,
  PLAYER_CONTACT_TYPES,
  normalizeParentContacts,
} from '../../lib/supabase.js'
import { getDraftParentContacts } from '../../hooks/players/playerProfileUtils.js'
import { isInviteEmailTemplate } from '../../lib/email-templates.js'
import { SectionCard } from '../ui/SectionCard.jsx'

const fieldClass = 'min-h-11 w-full rounded-lg border border-[#cfeedd] bg-[#f8fdf9] px-4 py-3 text-sm font-semibold text-[#101828] outline-none transition focus:border-[#20a464] focus:bg-white focus:ring-2 focus:ring-[#d7f8e5]'
const labelClass = 'mb-2 block text-sm font-black text-[#101828]'
const smallLabelClass = 'mb-2 block text-xs font-black uppercase tracking-[0.14em] text-[#067a46]'
const secondaryButtonClass = 'inline-flex min-h-11 items-center justify-center rounded-lg border border-[#cfeedd] bg-white px-4 py-3 text-sm font-black text-[#101828] transition hover:bg-[#e8f7ee] disabled:cursor-not-allowed disabled:opacity-60'

export function PlayerDetailsSection({
  directEmailSendingId,
  editingPlayerId,
  getDirectEmailTemplateOptions,
  getSelectedDirectEmailTemplateOption,
  isPromotingId,
  isSavingPlayer,
  onAddParentContact,
  onAddPlayerPosition,
  onCancelEditing,
  onMovePlayerToTrial,
  onParentContactDraftChange,
  onPlayerDraftChange,
  onPromotePlayer,
  onRemoveParentContact,
  onRemovePlayerPosition,
  onRefreshEmailTemplates,
  onSavePlayer,
  onSelectedDirectInviteDateChange,
  onSelectedDirectEmailTemplateChange,
  onSendDirectEmail,
  onStartEditingPlayer,
  playerDrafts,
  profilePlayers,
  selectedDirectInviteDates,
}) {
  return (
    <SectionCard
      title="Player details"
      description="Edit section, team, and parent contact details here."
    >
      {profilePlayers.length === 0 ? (
        <div className="rounded-lg border border-dashed border-[#9addb4] bg-[#f8fdf9] px-4 py-5 text-sm font-bold text-[#5f7468]">
          No saved player details yet. This profile was created from development history.
        </div>
      ) : (
        <div className="space-y-4">
          {profilePlayers.map((player) => {
            const draft = playerDrafts[player.id] ?? player
            const isEditing = editingPlayerId === player.id
            const contacts = normalizeParentContacts(player.parentContacts, {
              parentName: player.parentName,
              parentEmail: player.parentEmail,
            })

            return (
              <div key={player.id} className="rounded-lg border border-[#cfeedd] bg-[#f8fdf9] p-4 shadow-sm shadow-[#d7eadf]/60">
                {isEditing ? (
                  <PlayerDetailsEditor
                    draft={draft}
                    isSavingPlayer={isSavingPlayer}
                    onAddParentContact={() => onAddParentContact(player.id)}
                    onAddPlayerPosition={() => onAddPlayerPosition(player.id)}
                    onCancelEditing={onCancelEditing}
                    onParentContactDraftChange={(index, fieldName, value) =>
                      onParentContactDraftChange(player.id, index, fieldName, value)
                    }
                    onPlayerDraftChange={(fieldName, value) => onPlayerDraftChange(player.id, fieldName, value)}
                    onRemoveParentContact={(index) => onRemoveParentContact(player.id, index)}
                    onRemovePlayerPosition={(position) => onRemovePlayerPosition(player.id, position)}
                    onSavePlayer={() => onSavePlayer(player.id)}
                  />
                ) : (
                  <PlayerDetailsSummary
                    contacts={contacts}
                    directEmailSendingId={directEmailSendingId}
                    directEmailTemplates={getDirectEmailTemplateOptions(player)}
                    selectedDirectEmailTemplateKey={getSelectedDirectEmailTemplateOption(player)?.optionKey || ''}
                    selectedDirectInviteDate={selectedDirectInviteDates[player.id] || ''}
                    isPromoting={isPromotingId === player.id}
                    onMovePlayerToTrial={() => onMovePlayerToTrial(player.id)}
                    onPromotePlayer={() => onPromotePlayer(player.id)}
                    onRefreshEmailTemplates={onRefreshEmailTemplates}
                    onSelectedDirectInviteDateChange={(value) => onSelectedDirectInviteDateChange(player.id, value)}
                    onSelectedDirectEmailTemplateChange={(value) => onSelectedDirectEmailTemplateChange(player.id, value)}
                    onSendDirectEmail={() => onSendDirectEmail(player)}
                    onStartEditingPlayer={() => onStartEditingPlayer(player)}
                    player={player}
                  />
                )}
              </div>
            )
          })}
        </div>
      )}
    </SectionCard>
  )
}

function PlayerDetailsEditor({
  draft,
  isSavingPlayer,
  onAddParentContact,
  onAddPlayerPosition,
  onCancelEditing,
  onParentContactDraftChange,
  onPlayerDraftChange,
  onRemoveParentContact,
  onRemovePlayerPosition,
  onSavePlayer,
}) {
  const savingDisabledReason = isSavingPlayer ? 'Please wait while player details are being saved.' : undefined

  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      <label className="block">
        <span className={labelClass}>Player Name</span>
        <input
          value={draft.playerName}
          onChange={(event) => onPlayerDraftChange('playerName', event.target.value)}
          onKeyDown={(event) => event.stopPropagation()}
          className={fieldClass}
        />
      </label>
      <label className="block">
        <span className={labelClass}>Section</span>
        <select
          value={draft.section}
          onChange={(event) => onPlayerDraftChange('section', event.target.value)}
          className={fieldClass}
        >
          {EVALUATION_SECTIONS.map((section) => (
            <option key={section} value={section}>
              {section}
            </option>
          ))}
        </select>
      </label>
      <label className="block">
        <span className={labelClass}>Shirt Number</span>
        <input
          value={draft.shirtNumber ?? ''}
          onChange={(event) => onPlayerDraftChange('shirtNumber', event.target.value)}
          inputMode="numeric"
          className={fieldClass}
        />
      </label>
      <label className="block">
        <span className={labelClass}>Team</span>
        <input
          value={draft.team}
          onChange={(event) => onPlayerDraftChange('team', event.target.value)}
          className={fieldClass}
        />
      </label>
      <div className="md:col-span-2 xl:col-span-3">
        <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <span className="block text-sm font-black text-[#101828]">Contacts</span>
            <p className="mt-1 text-xs font-semibold leading-5 text-[#5f7468]">
              Add parent or guardian contacts used for player communication.
            </p>
          </div>
          <button
            type="button"
            onClick={onAddParentContact}
            className={`${secondaryButtonClass} w-full sm:w-auto`}
          >
            Add Another Contact
          </button>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          {getDraftParentContacts(draft).map((contact, index) => (
            <div key={index} className="rounded-lg border border-[#cfeedd] bg-white p-3 shadow-sm shadow-[#d7eadf]/60">
              <p className="mb-3 text-xs font-black uppercase tracking-[0.14em] text-[#067a46]">
                Contact {index + 1}
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block">
                  <span className={smallLabelClass}>Name</span>
                  <input
                    value={contact.name}
                    onChange={(event) => onParentContactDraftChange(index, 'name', event.target.value)}
                    className={fieldClass}
                  />
                </label>
                <label className="block">
                  <span className={smallLabelClass}>Email</span>
                  <input
                    type="email"
                    value={contact.email}
                    onChange={(event) => onParentContactDraftChange(index, 'email', event.target.value)}
                    className={fieldClass}
                  />
                </label>
              </div>
              <button
                type="button"
                onClick={() => onRemoveParentContact(index)}
                className={`${secondaryButtonClass} mt-3 min-h-10 w-full px-3 py-2 text-xs sm:w-auto`}
              >
                Remove Contact
              </button>
            </div>
          ))}
        </div>
      </div>
      <div className="md:col-span-2 xl:col-span-3">
        <span className={labelClass}>Player Positions</span>
        <div className="flex flex-col gap-3 sm:flex-row">
          <input
            value={draft.positionDraft ?? ''}
            onChange={(event) => onPlayerDraftChange('positionDraft', event.target.value)}
            placeholder="Add position"
            className={fieldClass}
          />
          <button
            type="button"
            onClick={onAddPlayerPosition}
            className={secondaryButtonClass}
          >
            Add Position
          </button>
        </div>
        {(draft.positions ?? []).length > 0 ? (
          <div className="mt-3 flex flex-wrap gap-2">
            {draft.positions.map((position) => (
              <button
                key={position}
                type="button"
                onClick={() => onRemovePlayerPosition(position)}
                className="inline-flex min-h-10 items-center justify-center rounded-lg border border-[#cfeedd] bg-white px-3 py-2 text-sm font-black text-[#101828] transition hover:bg-[#e8f7ee]"
              >
                {position} remove
              </button>
            ))}
          </div>
        ) : (
          <p className="mt-2 text-xs font-semibold leading-5 text-[#5f7468]">No positions entered.</p>
        )}
      </div>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <button
          type="button"
          disabled={isSavingPlayer}
          title={savingDisabledReason}
          onClick={onSavePlayer}
          className="inline-flex min-h-11 items-center justify-center rounded-lg bg-[#067a46] px-4 py-3 text-sm font-black text-white transition hover:bg-[#05603a] disabled:cursor-not-allowed disabled:opacity-60"
        >
          Save
        </button>
        <button
          type="button"
          disabled={isSavingPlayer}
          title={savingDisabledReason}
          onClick={onCancelEditing}
          className={secondaryButtonClass}
        >
          Cancel
        </button>
      </div>
    </div>
  )
}

function PlayerDetailsSummary({
  contacts,
  directEmailSendingId,
  directEmailTemplates,
  isPromoting,
  onMovePlayerToTrial,
  onPromotePlayer,
  onRefreshEmailTemplates,
  onSelectedDirectInviteDateChange,
  onSelectedDirectEmailTemplateChange,
  onSendDirectEmail,
  onStartEditingPlayer,
  player,
  selectedDirectInviteDate,
  selectedDirectEmailTemplateKey,
}) {
  const directEmailId = `direct:${player.id}`
  const selectedTemplateKey = String(selectedDirectEmailTemplateKey ?? '').split(':').pop()
  const shouldShowInviteDate = isInviteEmailTemplate(selectedTemplateKey)
  const directEmailDisabledReason = directEmailSendingId === directEmailId
    ? 'Please wait while this email is being sent.'
    : directEmailTemplates.length === 0
      ? 'Enable a Direct Email template before sending email from here.'
      : undefined
  const promotionDisabledReason = isPromoting ? 'Please wait while this player is being updated.' : undefined

  return (
    <div className="space-y-4">
      <div className="grid flex-1 gap-3 md:grid-cols-2 2xl:grid-cols-6">
        <PlayerDetailItem label="Section" value={player.section} />
        <PlayerDetailItem label="Team" value={player.team || 'No team entered'} />
        <PlayerDetailItem label="Shirt Number" value={player.shirtNumber || 'Not entered'} />
        <div>
          <p className="text-xs font-black uppercase tracking-[0.16em] text-[#067a46]">Contacts</p>
          <div className="mt-2 space-y-1">
            {contacts.length > 0 ? (
              contacts.map((contact, index) => (
                <p key={index} className="break-words text-sm font-black text-[#101828]">
                  {contact.name || (contact.type === PLAYER_CONTACT_TYPES.self ? 'Player' : 'Parent/Guardian')}{contact.email ? ` | ${contact.email}` : ''}
                </p>
              ))
            ) : (
              <p className="text-sm font-black text-[#101828]">No contact details entered</p>
            )}
          </div>
        </div>
        <PlayerDetailItem
          label="Positions"
          value={player.positions?.length ? player.positions.join(', ') : 'No positions entered'}
        />
        <PlayerDetailItem label="Status" value={player.status === 'promoted' ? 'Promoted' : 'Active'} />
      </div>

      <div className="rounded-lg border border-[#cfeedd] bg-white p-4 shadow-sm shadow-[#d7eadf]/60">
        <div className="grid gap-3 lg:grid-cols-[minmax(220px,1fr)_minmax(160px,0.45fr)_auto_auto_auto] lg:items-end">
          {directEmailTemplates.length > 0 ? (
            <label className="block">
              <span className={labelClass}>Email template</span>
              <select
                value={selectedDirectEmailTemplateKey}
                onChange={(event) => onSelectedDirectEmailTemplateChange(event.target.value)}
                onFocus={onRefreshEmailTemplates}
                className={fieldClass}
              >
                {directEmailTemplates.map((template) => (
                  <option key={template.optionKey} value={template.optionKey}>
                    {template.audience === 'player' ? 'Player' : 'Parent'}: {template.label}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <div className="rounded-lg border border-dashed border-[#9addb4] bg-[#f8fdf9] px-4 py-3 text-sm font-bold text-[#5f7468]">
              Enable a template for Direct Email before sending.
            </div>
          )}
          {shouldShowInviteDate ? (
            <label className="block">
              <span className={labelClass}>Invite date</span>
              <input
                type="date"
                value={selectedDirectInviteDate}
                onChange={(event) => onSelectedDirectInviteDateChange(event.target.value)}
                className={fieldClass}
              />
            </label>
          ) : (
            <div className="hidden lg:block" />
          )}
          <button
            type="button"
            onClick={onSendDirectEmail}
            disabled={directEmailSendingId === directEmailId || directEmailTemplates.length === 0}
            title={directEmailDisabledReason}
            className={`${secondaryButtonClass} w-full lg:w-auto`}
          >
            {directEmailSendingId === directEmailId ? 'Sending...' : 'Send Email'}
          </button>
          {player.section === 'Squad' ? (
            <button
              type="button"
              disabled={isPromoting}
              title={promotionDisabledReason}
              onClick={onMovePlayerToTrial}
              className={`${secondaryButtonClass} w-full lg:w-auto`}
            >
              {isPromoting ? 'Moving...' : 'Move to Trial'}
            </button>
          ) : (
            <button
              type="button"
              disabled={isPromoting}
              title={promotionDisabledReason}
              onClick={onPromotePlayer}
              className="inline-flex min-h-11 w-full items-center justify-center rounded-lg bg-[#067a46] px-4 py-3 text-sm font-black text-white transition hover:bg-[#05603a] disabled:cursor-not-allowed disabled:opacity-60 lg:w-auto"
            >
              {isPromoting ? 'Promoting...' : 'Promote to Squad'}
            </button>
          )}
          <button
            type="button"
            onClick={onStartEditingPlayer}
            className={`${secondaryButtonClass} w-full lg:w-auto`}
          >
            Edit Details
          </button>
        </div>
      </div>
    </div>
  )
}

function PlayerDetailItem({ label, value }) {
  return (
    <div>
      <p className="text-xs font-black uppercase tracking-[0.16em] text-[#067a46]">{label}</p>
      <p className="mt-2 text-sm font-black text-[#101828]">{value}</p>
    </div>
  )
}
