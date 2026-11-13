import { createHash } from 'node:crypto'
import { readPitcheroCsv } from './_data-transfer-tabular.js'

export const PITCHERO_TEMPLATE = 'FP-V1-PITCHERO-1'

const EMAIL = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/
const SHEET = 'Pitchero'
const text = (value) => String(value ?? '').trim()
const key = (value) => text(value).normalize('NFKC').replace(/\s+/g, ' ').toLowerCase()
const headerKey = (value) => key(value).replace(/[^a-z0-9]/g, '')
const fullName = (person) => [person.first, person.last].filter(Boolean).join(' ')
const personName = (record) => text(record.player_name) || [record.first_name, record.last_name].filter(Boolean).join(' ')
const tokens = (value) => text(value).split(/[,;|\n]/).map(text).filter(Boolean)
const reference = (prefix, ...parts) => `${prefix}-PITCHERO-${createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0, 24)}`

function fail(message, code) {
  throw Object.assign(new Error(message), { code })
}

function indexBy(records, getKey) {
  const result = new Map()
  for (const record of records) {
    const value = getKey(record)
    if (value) result.set(value, [...(result.get(value) || []), record])
  }
  return result
}

function splitName(name) {
  const parts = text(name).split(/\s+/)
  return { first: parts.slice(0, -1).join(' '), last: parts.length > 1 ? parts.at(-1) : '' }
}

function issue(row, column, message, code = 'PITCHERO_UNKNOWN') {
  return { sheet: SHEET, row, column, message, code }
}

function dateOfBirth(value) {
  if (!value) return ''
  const uk = value.match(/^(\d{1,2})[/.:-](\d{1,2})[/.:-](\d{4})$/)
  const iso = uk ? `${uk[3]}-${uk[2].padStart(2, '0')}-${uk[1].padStart(2, '0')}` : value
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return ''
  const parsed = new Date(iso)
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === iso && iso >= '1900-01-01'
    && iso <= new Date().toISOString().slice(0, 10) ? iso : ''
}

function isAdult(date, today = new Date()) {
  if (!date) return false
  const [year, month, day] = date.split('-').map(Number)
  const years = today.getUTCFullYear() - year
  return years > 18 || (years === 18 && (today.getUTCMonth() + 1 > month
    || (today.getUTCMonth() + 1 === month && today.getUTCDate() >= day)))
}

function field(row, names, headers) {
  for (const name of names) {
    const index = headers.indexOf(headerKey(name))
    if (index >= 0 && text(row[index])) return text(row[index])
  }
  return ''
}

export async function readPitcheroMembers(buffer, options) {
  const { headers: labels, rows } = await readPitcheroCsv(buffer, options)
  const headers = labels.map(headerKey)
  if (new Set(headers).size !== headers.length || !['firstname', 'lastname'].every((name) => headers.includes(name))
    || !['registered', 'children', 'parents', 'role', 'roles', 'memberid', 'team', 'teams'].some((name) => headers.includes(name))) {
    fail('Choose a Pitchero membership CSV with First name and Last name columns.', 'PITCHERO_HEADERS_REQUIRED')
  }
  if (!rows.length) fail('The Pitchero export contains no member rows.', 'PITCHERO_EMPTY')
  const warnings = []
  const relevant = new Set(['firstname', 'lastname', 'registered', 'children', 'parents', 'email', 'emailaddress', 'memberid',
    'pitcheroid', 'id', 'dateofbirth', 'dob', 'birthdate', 'roles', 'role', 'memberroles', 'memberrole', 'membertype',
    'teams', 'team', 'playerteams', 'playerteam', 'teamname'])
  const people = rows.map((cells, index) => {
    const row = index + 2
    const get = (...names) => field(cells, names, headers)
    const first = get('first name')
    const last = get('last name')
    const name = fullName({ first, last })
    const memberId = get('member id', 'pitchero id', 'id')
    const emailValue = get('email', 'email address')
    const email = EMAIL.test(emailValue) && emailValue.length <= 254 ? emailValue.toLowerCase() : ''
    const birthValue = get('date of birth', 'dob', 'birth date')
    const birth = dateOfBirth(birthValue)
    const childNames = new Map(tokens(get('children', 'child names')).map((child) => [key(child), child]))
    const children = [...childNames.keys()]
    const parents = tokens(get('parents', 'parent names'))
    const roles = get('roles', 'role', 'member roles', 'member role', 'member type')
    const teams = tokens(get('teams', 'team', 'player teams', 'player team', 'team name'))
    const explicitPlayer = /\bplayers?\b/i.test(roles)
    const explicitParent = /\b(parents?|guardians?|carers?)\b/i.test(roles)
    const staff = !explicitPlayer && /\b(coach|admin|webmaster|staff|official|supporter|club member)\b/i.test(roles)
    const blankFields = labels.filter((label, position) => relevant.has(headers[position]) && !text(cells[position]))
    if (blankFields.length) warnings.push(issue(row, blankFields.join(', '), `${name || 'Unknown'}: ${blankFields.join(', ')} Unknown.`))
    if (emailValue && !email) warnings.push(issue(row, 'Email', `${name || 'Unknown'}: Email Unknown. Check the address in Pitchero.`, 'PITCHERO_INVALID_EMAIL'))
    if (birthValue && !birth) warnings.push(issue(row, 'Date of birth', `${name || 'Unknown'}: Date of birth Unknown. Use day/month/year or an ISO date.`, 'PITCHERO_INVALID_BIRTH'))
    return { row, name, first, last, memberId, email, birth, children, childNames, parents, teams, explicitPlayer, explicitParent, staff }
  })

  const peopleByName = indexBy(people, (person) => key(person.name))
  const peopleByMemberId = indexBy(people, (person) => key(person.memberId))
  const parentRefs = new Set(people.flatMap((person) => person.parents.map(key)))
  const guardianPeople = people.filter((person) => person.children.length || person.explicitParent
    || parentRefs.has(key(person.name)) || (person.memberId && parentRefs.has(key(person.memberId))))
  const guardianSet = new Set(guardianPeople)
  const guardianByName = indexBy(guardianPeople, (person) => key(person.name))
  const guardianByMemberId = indexBy(guardianPeople, (person) => key(person.memberId))
  const guardiansByChild = new Map()
  for (const guardian of guardianPeople) {
    for (const child of guardian.children) {
      guardiansByChild.set(child, [...(guardiansByChild.get(child) || []), guardian])
    }
  }
  const players = []
  for (const person of people) {
    const listedChild = guardiansByChild.has(key(person.name)) || (person.memberId && guardiansByChild.has(key(person.memberId)))
    const playerEvidence = person.explicitPlayer || person.parents.length || listedChild || (!guardianSet.has(person) && !person.staff && person.teams.length)
    if (person.staff) warnings.push(issue(person.row, 'Role', `${person.name || 'Unknown'}: Review staff or member access separately.`, 'PITCHERO_STAFF_REVIEW'))
    if (!playerEvidence && (guardianSet.has(person) || person.staff)) {
      if (guardianSet.has(person) && !person.children.length && !parentRefs.has(key(person.name))
        && (!person.memberId || !parentRefs.has(key(person.memberId)))) {
        warnings.push(issue(person.row, 'Children', `${person.name || 'Unknown'}: Children Unknown. Confirm which players to link.`))
      }
      continue
    }
    players.push({
      ...person,
      id: `member-${person.row}`,
      playerEvidence: Boolean(playerEvidence),
      sourceMemberDuplicate: Boolean(person.memberId && peopleByMemberId.get(key(person.memberId))?.length > 1),
      requiresRelationshipReview: Boolean(listedChild && peopleByName.get(key(person.name))?.length > 1),
      sourceGuardians: [
        ...(guardiansByChild.get(key(person.name)) || []),
        ...(guardiansByChild.get(key(person.memberId)) || []),
      ],
    })
  }
  for (const [child, guardians] of guardiansByChild) {
    if (peopleByName.has(child) || peopleByMemberId.has(child)) continue
    const name = guardians[0].childNames.get(child)
    players.push({
      ...splitName(name), name, id: `child-${guardians[0].row}-${guardians[0].children.indexOf(child)}`,
      row: guardians[0].row, parents: [], teams: [], playerEvidence: true, sourceGuardians: guardians,
      requiresRelationshipReview: guardians.length > 1,
    })
  }

  for (const player of players) {
    for (const parentRef of player.parents) {
      const matches = guardianByMemberId.get(key(parentRef)) || guardianByName.get(key(parentRef)) || []
      if (matches.length === 1 && matches[0].row !== player.row) player.sourceGuardians.push(matches[0])
      else if (!matches.length && splitName(parentRef).last && !/\d/.test(parentRef)) {
        player.sourceGuardians.push({ ...splitName(parentRef), name: parentRef, row: player.row, email: '' })
      } else {
        warnings.push(issue(player.row, 'Parents', `${player.name || 'Unknown'}: Parent identity Unknown. Check the relationship in Pitchero.`, 'PITCHERO_PARENT_AMBIGUOUS'))
      }
    }
    player.sourceGuardians = [...new Set(player.sourceGuardians)]
    player.kind = player.birth
      ? isAdult(player.birth) ? 'adult' : 'junior'
      : player.sourceGuardians.length || player.parents.length ? 'junior' : ''
    player.team = player.teams.length === 1 ? player.teams[0] : ''
  }

  return { players, warnings }
}

export function previewPitcheroMembers({ players, warnings }) {
  return {
    players: players.map(({ id, name, first, last, row, birth, email, kind, team, teams, sourceGuardians, requiresRelationshipReview, playerEvidence, sourceMemberDuplicate }) => ({
      id, name, first, last, row, birth: birth || '', email: email || '', kind, team, teams,
      parents: sourceGuardians.map((guardian) => ({ name: guardian.name, email: guardian.email })),
      requiresRelationshipReview, playerEvidence, sourceMemberDuplicate,
    })),
    warnings: [...new Map(warnings.map((warning) => [JSON.stringify(warning), warning])).values()],
  }
}

function checkedText(value, limit) {
  const result = typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : ''
  return result.length <= limit && !/[\p{Cc}]/u.test(result) && key(result) !== 'unknown' ? result : ''
}

function planItem(values, row, existing, action = existing ? 'unchanged' : 'create') {
  return { action, entity_id: existing?.id || '', expected_updated_at: existing?.updated_at || '', source_row: row, values }
}

function addContactUpdates(item, current) {
  if (!current) return
  const stored = current.parent_contacts?.length
    ? current.parent_contacts
    : [{ name: current.parent_name, email: current.parent_email, type: current.contact_type === 'self' ? 'self' : 'parent' }]
  item.pitchero_contacts = item.pitchero_contacts.filter((contact) => !stored.some((other) => (
    other.type === contact.type && (key(other.email) === contact.email && Boolean(contact.email)
      || key(other.name) === key(contact.name) || contact.type === 'self' && Boolean(other.email))
  )))
  item.pitchero_update = item.pitchero_contacts.length > 0 || Boolean(item.values.date_of_birth && !current.date_of_birth)
}

export function buildPitcheroPlan({ source, existing, scope, decisions, season }) {
  const warnings = [...source.warnings]
  const teams = new Map()
  const players = []
  const guardians = new Map()
  const links = []
  const inputDecisions = decisions && typeof decisions === 'object' && !Array.isArray(decisions) ? decisions : {}
  const teamsByName = indexBy(existing.teams, (team) => key(team.name))
  const teamsById = new Map(existing.teams.map((team) => [team.id, team]))
  const playersByName = indexBy(existing.players, (player) => key(personName(player)))
  const guardiansByEmail = indexBy(existing.guardians, (guardian) => key(guardian.email))
  const guardiansByName = indexBy(existing.guardians, (guardian) => key(personName(guardian)))
  const linksByPlayer = indexBy(existing.links, (link) => link.player_id)
  const sourceGuardians = [...new Set(source.players.flatMap((player) => player.sourceGuardians))]
  const legacyByEmail = indexBy(existing.links.filter((link) => !link.guardian_id), (link) => key(link.email))
  const sourceGuardiansByEmail = indexBy(sourceGuardians, (guardian) => key(guardian.email))
  const existingContactsByEmail = indexBy(existing.players.flatMap((record) => [
    ...(record.parent_contacts || []), { email: record.parent_email, name: record.parent_name },
  ]), (contact) => key(contact.email))
  const sourceGuardiansByName = indexBy(sourceGuardians, (guardian) => key(guardian.name))
  const candidatePlayers = []

  function warn(row, column, message, code) {
    warnings.push(issue(row, column, message, code))
  }

  for (const player of source.players) {
    const choice = Object.hasOwn(inputDecisions, player.id) ? inputDecisions[player.id] || {} : {}
    const first = checkedText(choice.first ?? player.first, 120)
    const last = checkedText(choice.last ?? player.last, 120)
    const name = fullName({ first, last })
    const label = name || player.name || 'Unknown'
    const kind = choice.kind ?? player.kind
    const birth = dateOfBirth(text(choice.birth ?? player.birth))
    const emailValue = text(choice.email ?? player.email)
    const email = EMAIL.test(emailValue) && emailValue.length <= 254 ? emailValue.toLowerCase() : ''
    if (choice.birth && !birth) {
      warn(player.row, 'Date of birth', `${label}: Date of birth Unknown. Enter a valid date.`)
      continue
    }
    if (kind === 'skip') {
      warn(player.row, 'Player', `${label}: Excluded by Club Admin.`, 'PITCHERO_SKIPPED')
      continue
    }
    if (!first || !last || player.sourceMemberDuplicate) {
      warn(player.row, 'Player name', `${label}: Confirm the full name and resolve repeated Pitchero member IDs.`, 'PITCHERO_PLAYER_REVIEW')
      continue
    }
    if (!['adult', 'junior'].includes(kind) || (!player.playerEvidence && choice.kind !== kind)
      || (birth && isAdult(birth) !== (kind === 'adult'))) {
      warn(player.row, 'Player role', `${label}: Player role Unknown. Confirm junior or adult using their date of birth where available.`, 'PITCHERO_ROLE_REVIEW')
      continue
    }
    const teamName = checkedText(choice.team ?? player.team, 160)
    const teamById = teamsById.get(choice.teamId)
    const teamMatches = teamsByName.get(key(teamName)) || []
    const existingTeam = teamById || (teamMatches.length === 1 ? teamMatches[0] : null)
    if ((!teamById && !teamName) || (choice.teamId && !teamById) || (!teamById && teamMatches.length > 1)
      || (existingTeam && (existingTeam.status !== 'active' || existingTeam.archived_at))) {
      warn(player.row, 'Team', `${label}: Team Unknown. Select an active team or enter the new team name.`, 'PITCHERO_TEAM_REVIEW')
      continue
    }
    if (player.requiresRelationshipReview && kind === 'junior' && choice.confirmRelationships !== true) {
      warn(player.row, 'Parents', `${label}: Confirm the listed parent relationships for this repeated name.`, 'PITCHERO_RELATIONSHIP_REVIEW')
      continue
    }
    candidatePlayers.push({ player, first, last, name, kind, birth, email, choice, existingTeam, teamName: existingTeam?.name || teamName })
  }

  const candidatesByName = indexBy(candidatePlayers, (candidate) => key(candidate.name))
  for (const candidate of candidatePlayers) {
    const { player, first, last, name, kind, birth, email: playerEmail, choice, existingTeam, teamName } = candidate
    const sameName = candidatesByName.get(key(name))
    if (sameName.filter((other) => key(other.teamName) === key(teamName)).length > 1
      || sameName.some((other) => other !== candidate && (!birth || !other.birth || birth === other.birth))) {
      warn(player.row, 'Player', `${name}: Multiple player rows match this name. Confirm the correct player in Pitchero.`, 'PITCHERO_DUPLICATE_PLAYER')
      continue
    }
    const teamReference = existingTeam?.transfer_reference || reference('TEAM', scope.clubId, key(teamName))
    const teamKey = existingTeam?.id || teamReference
    const playerReference = reference('PLAYER', scope.clubId, key(teamName), key(name))
    const matching = playersByName.get(key(name)) || []
    const sameTeam = matching.filter((record) => record.team_id === existingTeam?.id)
    const current = sameTeam.length === 1 ? sameTeam[0] : null
    const confirmed = current && (current.transfer_reference === playerReference
      || (birth && current.date_of_birth === birth) || choice.confirmExisting === true)
    if ((matching.length && !confirmed) || (current && (current.archived_at || current.status !== 'active'
      || (birth && current.date_of_birth && birth !== current.date_of_birth)
      || (kind === 'junior' && (current.contact_type === 'self' || isAdult(current.date_of_birth)))
      || (kind === 'adult' && (current.contact_type !== 'self' || (current.date_of_birth && !isAdult(current.date_of_birth))))))) {
      warn(player.row, 'Player', `${name}: Possible existing player. Confirm the matching active roster record, or resolve differences in Players.`, 'PITCHERO_DUPLICATE_PLAYER')
      continue
    }
    if (kind === 'adult' && (linksByPlayer.get(current?.id) || []).some((link) => link.status !== 'revoked')) {
      warn(player.row, 'Player role', `${name}: Review their existing parent relationships before importing as an adult player.`, 'PITCHERO_ROLE_REVIEW')
      continue
    }
    if (kind === 'adult' && !birth && !current?.date_of_birth) warn(player.row, 'Date of birth', `${name}: Date of birth Unknown. Confirm before sending a Player setup invitation.`)
    if (kind === 'junior' && !birth && !current?.date_of_birth) warn(player.row, 'Date of birth', `${name}: Date of birth Unknown.`)
    if (kind === 'adult' && !playerEmail && !current?.parent_email && !current?.parent_contacts?.some((contact) => contact.type === 'self' && contact.email)) {
      warn(player.row, 'Email', `${name}: Player email Unknown. Confirm their own email before sending a setup invitation.`)
    }
    if (!teams.has(teamKey)) teams.set(teamKey, planItem({
      transfer_reference: teamReference, name: teamName, season, status: 'active',
      age_group: /\b(?:u|under[ -]?)\d{1,2}\b/i.exec(teamName)?.[0] || '',
    }, player.row, existingTeam))

    const values = {
      transfer_reference: current?.transfer_reference || playerReference,
      first_name: first, last_name: last, team_reference: teamReference, date_of_birth: birth,
      section: 'Squad', status: 'active',
    }
    const item = {
      ...planItem(values, player.row, current),
      team_entity_id: existingTeam?.id || '',
      pitchero_kind: kind,
      pitchero_contacts: [],
    }
    players.push(item)
    if (kind === 'adult') {
      const existingSelfEmail = current?.parent_contacts?.find((contact) => contact.type === 'self' && contact.email)?.email
        || current?.parent_email
      if (playerEmail && existingSelfEmail && key(existingSelfEmail) !== playerEmail) {
        warn(player.row, 'Email', `${name}: Player email differs from the saved contact. Check it in Players.`, 'PITCHERO_EMAIL_REVIEW')
      }
      if (playerEmail && !existingSelfEmail) {
        const matchingContacts = [
          ...(sourceGuardiansByEmail.get(playerEmail) || []),
          ...(guardiansByEmail.get(playerEmail) || []),
          ...(existingContactsByEmail.get(playerEmail) || []),
        ]
        const conflicts = matchingContacts.some((contact) => key(contact.name || personName(contact)) !== key(name))
          || (legacyByEmail.has(playerEmail) && !matchingContacts.length)
        if (conflicts) {
          warn(player.row, 'Email', `${name} has a matching contact email on record. Confirm the player’s own address.`, 'PITCHERO_EMAIL_REVIEW')
        } else {
          item.pitchero_contacts.push({ name, email: playerEmail, type: 'self' })
        }
      }
      addContactUpdates(item, current)
      continue
    }
    const linkedGuardians = new Set()
    const existingLinks = linksByPlayer.get(current?.id) || []
    for (const guardian of player.sourceGuardians) {
      const guardianName = fullName(guardian)
      const email = guardian.email || ''
      if (!checkedText(guardian.first, 120) || !checkedText(guardian.last, 120)) {
        warn(guardian.row, 'Parent name', `${name}: Parent name Unknown. Check the relationship in Pitchero.`)
        continue
      }
      const guardianKey = email ? `email:${email}` : `name:${key(guardianName)}`
      if (linkedGuardians.has(guardianKey)) continue
      linkedGuardians.add(guardianKey)
      const ref = reference('GUARDIAN', scope.clubId, guardianKey)
      const byName = guardiansByName.get(key(guardianName)) || []
      const matches = email ? guardiansByEmail.get(email) || [] : byName.filter((record) => record.transfer_reference === ref)
      const currentGuardian = matches.length === 1 ? matches[0] : null
      const sourceSameEmail = sourceGuardiansByEmail.get(email) || []
      const sourceSameName = sourceGuardiansByName.get(key(guardianName)) || []
      const otherSourceIdentity = email
        ? sourceSameEmail.some((other) => key(other.name) !== key(guardianName))
        : sourceSameName.some((other) => other.email || other.row !== guardian.row)
      const legacyLink = email && existingLinks.find((link) => key(link.email) === email)
      const otherLegacyLink = email && legacyByEmail.has(email)
      if (otherSourceIdentity || matches.length > 1 || (currentGuardian && (key(personName(currentGuardian)) !== key(guardianName) || currentGuardian.status !== 'active'))
        || (!currentGuardian && byName.length) || (legacyLink?.guardian_id && legacyLink.guardian_id !== currentGuardian?.id)
        || (!currentGuardian && otherLegacyLink && !legacyLink)) {
        warn(guardian.row, 'Parent identity', `${guardianName}: Possible duplicate or conflicting contact. Review before linking to ${name}.`, 'PITCHERO_DUPLICATE_PARENT')
        continue
      }
      const prior = existingLinks.find((link) => (currentGuardian && link.guardian_id === currentGuardian.id) || (email && key(link.email) === email))
      if (prior?.status === 'revoked' || (prior && prior.team_id !== current?.team_id)) {
        warn(guardian.row, 'Parent relationship', `${guardianName}: Review existing access for ${name}.`, 'PITCHERO_PARENT_ACCESS_REVIEW')
        continue
      }
      if (!email) warn(guardian.row, 'Email', `${guardianName}: Parent email Unknown.`)
      item.pitchero_contacts.push({ name: guardianName, email, type: 'parent' })
      if (prior) continue
      if (!guardians.has(guardianKey)) guardians.set(guardianKey, planItem({
        transfer_reference: currentGuardian?.transfer_reference || ref,
        first_name: guardian.first, last_name: guardian.last, email: email || null, status: 'active',
      }, guardian.row, currentGuardian))
      links.push({
        action: 'link', source_row: player.row, player_entity_id: current?.id || '', guardian_entity_id: currentGuardian?.id || '',
        team_entity_id: existingTeam?.id || '', expected_player_updated_at: current?.updated_at || '',
        values: {
          player_reference: values.transfer_reference, guardian_reference: currentGuardian?.transfer_reference || ref,
          relationship: 'Parent', guardian_email: email,
        },
      })
    }
    addContactUpdates(item, current)
    if (!player.sourceGuardians.length && !existingLinks.some((link) => link.status !== 'revoked')) {
      warn(player.row, 'Parents', `${name}: Parent or guardian Unknown.`)
    }
  }

  return {
    plan: {
      context: { planning_mode: 'pitchero', selected_season: season },
      teams: [...teams.values()], players, guardians: [...guardians.values()], links,
    },
    warnings: [...new Map(warnings.map((warning) => [JSON.stringify(warning), warning])).values()],
  }
}
