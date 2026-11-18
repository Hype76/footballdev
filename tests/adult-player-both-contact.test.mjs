import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { transformSync } from 'esbuild'
import { getAdultPlayerSetupEmail, isAdultPlayerBirthDate } from '../src/lib/adult-player-setup.js'
import { mapPlayerToRow } from '../src/lib/domain/player-normalizers.js'
import { ensureContactsForType } from '../src/hooks/players/addPlayerUtils.js'
import { getEditableParentContacts, addParentContactDraft } from '../src/hooks/players/playerProfileUtils.js'
import { buildCoachPlayerPayload, normalizeCoachPlayer } from '../apps/mobile-core/src/coachPlayersCore.js'

const self = { type: 'self', email: 'adult@example.test', name: 'Adult' }
const guardian = { type: 'parent', email: 'parent@example.test', name: 'Parent' }

test('actual Add Player save and web/mobile payloads preserve both adult and minor DOB with independent contacts', async () => {
  const source = await readFile('src/pages/AddPlayerPage.jsx', 'utf8')
  const start = source.indexOf('      const form = {', source.indexOf('const handleAddPlayer'))
  const end = source.indexOf('      const createdPlayer =', start)
  assert.ok(start >= 0 && end > start)
  const build = new Function('playerForm', 'ensureContactsForType', 'isAdultPlayerBirthDate', 'getAdultPlayerSetupEmail', source.slice(start, end) + ';return form')
  for (const [contactType, dateOfBirth, eligible] of [['both', '1990-01-01', true], ['both', '2015-01-01', false], ['both', '', false], ['self', '1990-01-01', true]]) {
    const form = build({ contactType, dateOfBirth, playerName: 'Player', parentContacts: [self, guardian] }, ensureContactsForType, isAdultPlayerBirthDate, getAdultPlayerSetupEmail)
    assert.equal(form.dateOfBirth, dateOfBirth)
    const web = mapPlayerToRow(form, { id: 'staff', clubId: 'club', activeTeamId: 'team' })
    const mobile = buildCoachPlayerPayload({ context: { clubId: 'club', activeTeamId: 'team' }, form })
    assert.equal(web.date_of_birth, dateOfBirth || null)
    assert.equal(mobile.date_of_birth, dateOfBirth || null)
    assert.equal(normalizeCoachPlayer(mobile).contactType, contactType)
    assert.equal(Boolean(getAdultPlayerSetupEmail(form)) && isAdultPlayerBirthDate(form.dateOfBirth), eligible)
    if (contactType === 'both') assert.deepEqual(web.parent_contacts.map(contact => contact.type), ['self', 'parent'])
  }
  assert.throws(() => build({ contactType: 'self', dateOfBirth: '2015-01-01', playerName: 'Minor', parentContacts: [self] }, ensureContactsForType, isAdultPlayerBirthDate, getAdultPlayerSetupEmail), /18 or over/)
  assert.equal(getAdultPlayerSetupEmail({ contactType: 'both', parentContacts: [guardian] }), '')
  assert.equal(getAdultPlayerSetupEmail({ contactType: 'both', parentContacts: [self, { ...self, email: 'other@example.test' }, guardian] }), '')
  const editable = getEditableParentContacts({ contactType: 'both', playerName: 'Adult', parentContacts: [guardian] })
  assert.ok(editable.some(contact => contact.type === 'self'))
  assert.ok(editable.some(contact => contact.type === 'parent'))
  const restored = addParentContactDraft({ player: { contactType: 'both', parentContacts: [guardian] } }, 'player').player.parentContacts
  assert.equal(restored[1].type, 'self')
})

test('actual Coach DOB field and status effect support both while Parent-only rows do not fetch adult status', async () => {
  const source = await readFile('apps/coach-mobile/src/CoachOperationalScreens.js', 'utf8')
  const changeStart = source.indexOf('<Chips onChange={(value) => setForm({', source.indexOf('Positions, separated by commas'))
  const changeEnd = source.indexOf(' styles={styles}', changeStart)
  const choice = source.slice(changeStart, changeEnd) + ' />'
  const choiceJs = transformSync('function render(form,setForm){return (' + choice + ')}', { loader: 'jsx', jsxFactory: 'h' }).code
  const renderChoice = new Function('h', 'Chips', choiceJs + ';return render')((_type, props) => props, 'Chips')
  for (const initial of [[], [guardian], [self, guardian]]) {
    let next
    renderChoice({ contactType: 'parent', parentContacts: initial }, value => { next = value }).onChange('both')
    assert.equal(next.contactType, 'both')
    assert.deepEqual([...new Set(next.parentContacts.map(contact => contact.type))].sort(), ['parent', 'self'])
    assert.ok(initial.every(contact => next.parentContacts.some(row => row.email === contact.email && row.type === contact.type)))
  }
  const line = source.split('\n').find(line => line.includes('Player date of birth (DD:MM:YYYY)'))
  const expression = line.trim().slice(1, -1)
  const compiled = transformSync('function render(form,styles,setForm){return (' + expression + ')}', { loader: 'jsx', jsxFactory: 'h' }).code
  const render = new Function('h', 'Field', compiled + ';return render')((_type, props) => props, 'Field')
  assert.equal(render({ contactType: 'both', dateOfBirth: '1990-01-02' }, {}, () => {}).value, '02:01:1990')
  assert.equal(render({ contactType: 'parent', dateOfBirth: '1990-01-02' }, {}, () => {}), null)
  const start = source.indexOf('  useEffect(() => {', source.indexOf('  const adultContactType ='))
  const end = source.indexOf('\n  }, [adultPlayerId, adultContactType,', start) + 5
  for (const [adultContactType, expected] of [['both', 1], ['self', 1], ['parent', 0]]) {
    let calls = 0
    const dependencies = { useEffect: callback => callback(), adultPlayerId: 'player', adultContactType, policy: { canEdit: true }, setAdultLinkStatus() {}, getCoachAdultPlayerLinkStatus: async () => { calls++; return { state: 'not_invited' } } }
    new Function(...Object.keys(dependencies), source.slice(start, end) + ');')(...Object.values(dependencies))
    await Promise.resolve()
    assert.equal(calls, expected)
  }
})
