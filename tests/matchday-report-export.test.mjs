import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import {
  buildCompletedReportCsv,
  buildCompletedReportCsvRows,
  buildCompletedReportPdf,
  getCompletedReportFilename,
  protectSpreadsheetFormulaValue,
} from '../src/lib/matchday-report-export.js'

const PRIVATE_EVENT_NOTE = 'Staff tactical note must stay private'
const PRIVATE_REPORT_NOTE = 'Private staff final report note'

function completedMatch() {
  return {
    id: 'match-internal-id-must-not-export',
    clubName: 'Atlético Test Club',
    teamId: 'team-internal-id-must-not-export',
    teamName: 'Atlético Test',
    opponent: "St. John's United",
    matchDate: '2026-07-22',
    homeAway: 'home',
    status: 'full_time',
    conclusionRule: 'extra_time_then_penalties',
    homeScore: 2,
    awayScore: 2,
    normalTimeHomeScore: 1,
    normalTimeAwayScore: 1,
    extraTimeHomeScore: 2,
    extraTimeAwayScore: 2,
    homeShootoutScore: 5,
    awayShootoutScore: 4,
    shootoutWinner: 'home',
    parentEmail: 'private.parent@example.test',
    finalReport: { staffNotes: PRIVATE_REPORT_NOTE },
    events: [
      {
        id: 'normal-penalty-internal-id',
        eventType: 'goal',
        eventStatus: 'active',
        teamSide: 'club',
        scorerName: 'María O\'Connor-Smith',
        minute: 45,
        stoppageMinute: 2,
        homeScore: 1,
        awayScore: 0,
        isPenaltyGoal: true,
        matchPhase: 'first_half',
        phaseOrder: 10,
        createdAt: '2026-07-22T18:45:00Z',
      },
      {
        id: 'away-goal-internal-id',
        eventType: 'goal',
        eventStatus: 'active',
        teamSide: 'opponent',
        scorerName: '=HYPERLINK("https://invalid.test")',
        minute: 88,
        homeScore: 1,
        awayScore: 1,
        matchPhase: 'second_half',
        phaseOrder: 30,
        createdAt: '2026-07-22T19:28:00Z',
      },
      {
        id: 'extra-time-penalty-internal-id',
        eventType: 'goal',
        eventStatus: 'active',
        teamSide: 'club',
        scorerName: 'José Núñez',
        minute: 105,
        homeScore: 2,
        awayScore: 1,
        isPenaltyGoal: true,
        matchPhase: 'extra_time_first_half',
        phaseOrder: 50,
        notes: PRIVATE_EVENT_NOTE,
        createdAt: '2026-07-22T19:55:00Z',
      },
      {
        id: 'extra-time-away-goal-internal-id',
        eventType: 'goal',
        eventStatus: 'active',
        teamSide: 'opponent',
        scorerName: 'Chloë D’Arcy',
        minute: 118,
        homeScore: 2,
        awayScore: 2,
        matchPhase: 'extra_time_second_half',
        phaseOrder: 70,
        createdAt: '2026-07-22T20:08:00Z',
      },
    ],
    shootoutEvents: [
      {
        id: 'kick-internal-id',
        teamSide: 'club',
        outcome: 'scored',
        kickNumber: 1,
        playerName: 'Ángel Díaz',
        eventStatus: 'active',
        createdAt: '2026-07-22T20:15:00Z',
      },
      {
        id: 'voided-kick-internal-id',
        teamSide: 'opponent',
        outcome: 'missed',
        kickNumber: 1,
        playerName: 'Renée Test',
        eventStatus: 'voided',
        createdAt: '2026-07-22T20:16:00Z',
      },
    ],
  }
}

test('completed report CSV is structured, ordered, UTF-8, formula-safe, and permission-aware', () => {
  const match = completedMatch()
  const parentRows = buildCompletedReportCsvRows(match, { audience: 'parent' })
  const parentCsv = buildCompletedReportCsv(match, { audience: 'parent' })
  const staffCsv = buildCompletedReportCsv(match, { audience: 'staff' })

  assert.equal(parentCsv.charCodeAt(0), 0xfeff)
  assert.match(parentCsv, /\r\n/)
  assert.equal(parentRows.length, 6)
  assert.deepEqual(parentRows.map((row) => row['Match phase']), [
    'Normal time, first half',
    'Normal time, second half',
    'Extra time, first period',
    'Extra time, second period',
    'Penalty shootout',
    'Penalty shootout',
  ])
  assert.equal(parentRows[0]['Match minute'], '45')
  assert.equal(parentRows[0]['Stoppage minute'], '2')
  assert.equal(parentRows[0]['Penalty goal'], 'Yes')
  assert.equal(parentRows[2]['Penalty goal'], 'Yes')
  assert.equal(parentRows[4]['Shootout result'], 'Scored')
  assert.equal(parentRows[5]['Shootout result'], 'Voided')
  assert.match(parentCsv, /María O'Connor-Smith/)
  assert.match(parentCsv, /José Núñez/)
  assert.match(parentCsv, /"'=HYPERLINK\(""https:\/\/invalid\.test""\)"/)
  assert.doesNotMatch(parentCsv, new RegExp(PRIVATE_EVENT_NOTE))
  assert.doesNotMatch(parentCsv, new RegExp(PRIVATE_REPORT_NOTE))
  assert.doesNotMatch(parentCsv, /match-internal-id|team-internal-id|private\.parent@example\.test/)
  assert.match(staffCsv, new RegExp(PRIVATE_EVENT_NOTE))
  assert.doesNotMatch(staffCsv, new RegExp(PRIVATE_REPORT_NOTE))
})

test('completed report PDF contains accurate visible report data and excludes private notes for parents', () => {
  const match = completedMatch()
  const parentBytes = buildCompletedReportPdf(match, { audience: 'parent' })
  const staffBytes = buildCompletedReportPdf(match, { audience: 'staff' })
  const parentPdf = Buffer.from(parentBytes).toString('latin1')
  const staffPdf = Buffer.from(staffBytes).toString('latin1')

  assert.ok(parentPdf.startsWith('%PDF-1.4'))
  assert.match(parentPdf, /Completed Match Report/)
  assert.match(parentPdf, /Normal time: 1 - 1/)
  assert.match(parentPdf, /After extra time: 2 - 2/)
  assert.match(parentPdf, /Penalty shootout: 5 - 4/)
  assert.match(parentPdf, /Shootout winner: Atlético Test/)
  assert.match(parentPdf, /Penalty goal/)
  assert.match(parentPdf, /María O'Connor-Smith/)
  assert.match(parentPdf, /Penalty shootout kicks/)
  assert.doesNotMatch(parentPdf, new RegExp(PRIVATE_EVENT_NOTE))
  assert.doesNotMatch(parentPdf, new RegExp(PRIVATE_REPORT_NOTE))
  assert.doesNotMatch(parentPdf, /match-internal-id|team-internal-id|private\.parent@example\.test/)
  assert.match(staffPdf, new RegExp(PRIVATE_EVENT_NOTE))
  assert.match(staffPdf, new RegExp(PRIVATE_REPORT_NOTE))
})

test('completed report filenames and spreadsheet formula protection are stable', () => {
  const match = completedMatch()
  assert.equal(getCompletedReportFilename(match, 'pdf'), '2026-07-22-atletico-test-v-st-john-s-united-completed-report.pdf')
  assert.equal(getCompletedReportFilename(match, 'csv'), '2026-07-22-atletico-test-v-st-john-s-united-completed-report.csv')
  assert.equal(protectSpreadsheetFormulaValue(' =2+2'), "' =2+2")
  assert.equal(protectSpreadsheetFormulaValue('@SUM(A1:A2)'), "'@SUM(A1:A2)")
  assert.equal(protectSpreadsheetFormulaValue('Ordinary text'), 'Ordinary text')
})

test('Add Player keeps positions immediately after name and the submit action at the true form end', async () => {
  const source = await readFile(new URL('../src/components/players/AddPlayerFormSection.jsx', import.meta.url), 'utf8')
  const playerNameIndex = source.indexOf('>Player name<')
  const positionsIndex = source.indexOf('>Player positions<')
  const shirtNumberIndex = source.indexOf('>Shirt number<')
  const contactsIndex = source.indexOf('{contactGroups.map')
  const submitIndex = source.indexOf('type="submit"')
  const formEndIndex = source.indexOf('</form>')

  assert.ok(playerNameIndex >= 0)
  assert.ok(playerNameIndex < positionsIndex)
  assert.ok(positionsIndex < shirtNumberIndex)
  assert.ok(contactsIndex < submitIndex)
  assert.ok(submitIndex < formEndIndex)
  assert.equal(source.slice(submitIndex, formEndIndex).includes('type="submit"'), true)
})
