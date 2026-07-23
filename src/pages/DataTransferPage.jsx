import { useEffect, useMemo, useState } from 'react'
import { isSuperAdmin, useAuth } from '../lib/auth.js'
import {
  confirmDataTransfer,
  DATA_TRANSFER_ACCEPT,
  DATA_TRANSFER_MAX_BYTES,
  DATA_TRANSFER_TEMPLATE_VERSION,
  downloadDataTransferErrorReport,
  downloadDataTransferRawWorkbook,
  downloadOrdinaryDataTransferExport,
  downloadSimpleDataTransferTemplate,
  downloadDataTransferWorkbook,
  inspectDataTransferSource,
  inspectDataTransferWorkbook,
  loadDataTransferDetails,
  loadDataTransferHistory,
  loadDataTransferScope,
  rollbackDataTransfer,
  SIMPLE_DATA_TRANSFER_TEMPLATE_VERSION,
} from '../lib/domain/data-transfer.js'

function formatDate(value) {
  if (!value) return 'Not completed'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString('en-GB')
}

function formatCounts(counts = {}) {
  const values = [
    ['Exported', counts.exported],
    ['Create', counts.create], ['Update', counts.update], ['Link', counts.link], ['Unchanged', counts.unchanged],
    ['Possible duplicate', counts.possible_duplicate], ['Conflict', counts.conflict], ['Error', counts.error],
  ].filter(([, value]) => Number(value || 0) > 0)
  return values.length ? values.map(([label, value]) => `${label} ${value}`).join(', ') : 'No row changes'
}

function StatusPill({ value }) {
  const good = ['completed', 'completed_with_warnings', 'ready_for_review', 'rolled_back', 'create', 'update', 'link', 'unchanged'].includes(value)
  const bad = ['failed', 'invalid', 'rollback_blocked', 'expired', 'conflict', 'error'].includes(value)
  const styles = good ? 'bg-emerald-50 text-emerald-800 ring-emerald-200' : bad ? 'bg-rose-50 text-rose-800 ring-rose-200' : 'bg-amber-50 text-amber-800 ring-amber-200'
  return <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-black ring-1 ${styles}`}>{String(value || 'unknown').replaceAll('_', ' ')}</span>
}

function ActionButton({ children, disabled, onClick, tone = 'primary', type = 'button' }) {
  const styles = tone === 'primary'
    ? 'bg-[#047857] text-white hover:bg-[#065f46]'
    : tone === 'danger'
      ? 'border border-rose-300 bg-white text-rose-800 hover:bg-rose-50'
      : 'border border-[#b8c9c0] bg-white text-[#274437] hover:bg-[#f0f7f3]'
  return <button type={type} disabled={disabled} onClick={onClick} className={`min-h-11 rounded-lg px-4 py-2 text-sm font-black transition ${styles} disabled:cursor-not-allowed disabled:opacity-50`}>{children}</button>
}

function ChoiceRow({ checked, description = '', disabled = false, id, label, onChange }) {
  return (
    <label htmlFor={id} className={`flex min-h-11 cursor-pointer items-start gap-2 rounded-lg border border-[#cfe0d6] bg-white px-3 py-2 text-sm text-[#274437] ${disabled ? 'cursor-not-allowed opacity-55' : 'hover:border-[#80ad96] hover:bg-[#f7faf8]'}`}>
      <input id={id} type="checkbox" disabled={disabled} checked={checked} onChange={onChange} className="mt-0.5 h-4 w-4 shrink-0 accent-[#047857]" />
      <span><span className="font-black">{label}</span>{description ? <span className="mt-0.5 block text-xs font-semibold leading-5 text-[#66756c]">{description}</span> : null}</span>
    </label>
  )
}

function SelectionRow({ checked, description = '', disabled = false, id, label, name, onChange, value }) {
  return (
    <label htmlFor={id} className={`flex min-h-11 cursor-pointer items-start gap-2 rounded-lg border bg-white px-3 py-2 text-sm text-[#274437] ${checked ? 'border-[#047857] ring-1 ring-[#80ad96]' : 'border-[#cfe0d6]'} ${disabled ? 'cursor-not-allowed opacity-55' : 'hover:border-[#80ad96] hover:bg-[#f7faf8]'}`}>
      <input id={id} type="radio" name={name} value={value} disabled={disabled} checked={checked} onChange={onChange} className="mt-0.5 h-4 w-4 shrink-0 accent-[#047857]" />
      <span><span className="font-black">{label}</span>{description ? <span className="mt-0.5 block text-xs font-semibold leading-5 text-[#66756c]">{description}</span> : null}</span>
    </label>
  )
}

function FieldChangeDetails({ row }) {
  const proposed = row.proposedChanges || row.proposed_changes || {}
  const fields = proposed.fields || []
  if (!fields.length) return <span className="text-[#66756c]">No field changes</span>
  return (
    <details className="min-w-72">
      <summary className="cursor-pointer font-black text-[#047857]">Inspect {fields.length} field{fields.length === 1 ? '' : 's'}</summary>
      <ul className="mt-2 space-y-2 text-xs">
        {fields.map((field, index) => (
          <li key={`${field.field}-${index}`} className="rounded-md bg-[#f7faf8] p-2">
            <p className="font-black">{field.field}</p>
            <p>Platform: {Array.isArray(field.platform_value) ? field.platform_value.join(', ') : String(field.platform_value ?? '') || 'blank'}</p>
            <p>Workbook: {Array.isArray(field.workbook_value) ? field.workbook_value.join(', ') : String(field.workbook_value ?? '') || 'blank'}</p>
            <p>Action: {field.proposed_action}</p>
          </li>
        ))}
      </ul>
    </details>
  )
}

export function DataTransferPage() {
  const { user } = useAuth()
  const platformMode = isSuperAdmin(user)
  const userId = user?.id || user?.email || ''
  const userClubId = user?.clubId || ''
  const [clubs, setClubs] = useState([])
  const [clubId, setClubId] = useState(platformMode ? '' : userClubId)
  const [scopeMode, setScopeMode] = useState('')
  const [selectedTeamIds, setSelectedTeamIds] = useState([])
  const [auditReason, setAuditReason] = useState('')
  const [allowTeamCreation, setAllowTeamCreation] = useState(false)
  const [createPossibleDuplicates, setCreatePossibleDuplicates] = useState(false)
  const [fillBlankFields, setFillBlankFields] = useState(false)
  const [season, setSeason] = useState('')
  const [exportDataset, setExportDataset] = useState('players')
  const [exportFormat, setExportFormat] = useState('csv')
  const [exportRecordStatus, setExportRecordStatus] = useState('active')
  const [exportSeason, setExportSeason] = useState('all')
  const [updateConflicts, setUpdateConflicts] = useState(false)
  const [scope, setScope] = useState(null)
  const [scopeBusy, setScopeBusy] = useState(false)
  const [actionBusy, setActionBusy] = useState('')
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [file, setFile] = useState(null)
  const [sourceInspection, setSourceInspection] = useState(null)
  const [selectedSheetName, setSelectedSheetName] = useState('')
  const [columnMappings, setColumnMappings] = useState([])
  const [dateConvention, setDateConvention] = useState('')
  const [teamMappings, setTeamMappings] = useState([])
  const [defaultTeamId, setDefaultTeamId] = useState('')
  const [inspection, setInspection] = useState(null)
  const [confirmationPhrase, setConfirmationPhrase] = useState('')
  const [confirmedReview, setConfirmedReview] = useState(false)
  const [history, setHistory] = useState([])
  const [selectedBatch, setSelectedBatch] = useState(null)
  const [previewFilter, setPreviewFilter] = useState('all')
  const [rollbackBatchId, setRollbackBatchId] = useState('')
  const [rollbackPhrase, setRollbackPhrase] = useState('')

  const scopePayload = useMemo(() => ({ clubId: clubId || userClubId, auditReason, clubWideScope: scopeMode === 'club', teamIds: scopeMode === 'teams' ? selectedTeamIds : [] }), [auditReason, clubId, scopeMode, selectedTeamIds, userClubId])
  const inspectionPayload = useMemo(() => ({
    ...scopePayload,
    allowTeamCreation,
    createPossibleDuplicates,
    fillBlankFields,
    importMode: 'additive',
    season,
    updateConflicts,
  }), [allowTeamCreation, createPossibleDuplicates, fillBlankFields, scopePayload, season, updateConflicts])
  const previewRows = inspection?.preview || selectedBatch?.preview || []
  const importFinished = ['completed', 'completed_with_warnings'].includes(inspection?.batch?.state)
  const hasConfirmedScope = scopeMode === 'club' || (scopeMode === 'teams' && selectedTeamIds.length > 0)
  const filteredPreview = previewFilter === 'all' ? previewRows : previewRows.filter((row) => (row.outcome || row.outcome) === previewFilter)
  const selectedSourceSheet = sourceInspection?.sheets?.find((sheet) => sheet.name === selectedSheetName) || null
  const mappedTargetFields = new Set(columnMappings.map((mapping) => mapping.targetField).filter(Boolean))
  const namesMapped = mappedTargetFields.has('player_full_name') || (mappedTargetFields.has('player_first_name') && mappedTargetFields.has('player_last_name'))
  const dateDecisionRequired = Boolean(selectedSourceSheet?.ambiguousDateSamples?.length && mappedTargetFields.has('date_of_birth'))
  const mappingReady = Boolean(sourceInspection?.portable || (selectedSourceSheet && namesMapped && (!dateDecisionRequired || dateConvention)))
  const exportSeasonOptions = useMemo(() => [...new Set([
    scope?.club?.season,
    ...(scope?.teams || []).map((team) => team.season),
  ].filter(Boolean))].sort(), [scope])

  function clearSourceInspection() {
    setSourceInspection(null)
    setSelectedSheetName('')
    setColumnMappings([])
    setDateConvention('')
    setTeamMappings([])
    setDefaultTeamId('')
    setInspection(null)
  }

  function applySheetMapping(sheetName, result = sourceInspection) {
    const sheet = result?.sheets?.find((candidate) => candidate.name === sheetName)
    setSelectedSheetName(sheetName)
    setColumnMappings((sheet?.mappings || []).map((mapping) => ({
      defaultValue: '',
      sourceColumn: mapping.sourceColumn,
      targetField: mapping.suggestedField,
      transformation: mapping.transformation || 'trim',
    })))
    setDateConvention('')
    setDefaultTeamId('')
    setTeamMappings((sheet?.teamValues || []).map((sourceValue) => ({ sourceValue, teamId: '', create: false })))
    setInspection(null)
  }

  async function refreshHistory(nextScope = scopePayload) {
    const result = await loadDataTransferHistory(nextScope)
    setHistory(result.history || [])
  }

  async function refreshScope(payload = scopePayload) {
    setScopeBusy(true)
    setError('')
    try {
      const result = await loadDataTransferScope(payload)
      if (result.clubs) setClubs(result.clubs)
      if (result.club) {
        setScope(result)
        setScopeMode(result.canManageClub ? '' : 'teams')
        setSelectedTeamIds([])
        setAllowTeamCreation(false)
        setExportSeason('all')
        await refreshHistory(payload)
      }
    } catch (requestError) {
      setScope(null)
      setError(requestError.message)
    } finally {
      setScopeBusy(false)
    }
  }

  useEffect(() => {
    let active = true
    async function loadInitialScope() {
      setScopeBusy(true)
      try {
        const result = await loadDataTransferScope(platformMode ? {} : { clubId: userClubId })
        if (!active) return
        if (result.clubs) setClubs(result.clubs)
        if (result.club) {
          setScope(result)
          setScopeMode(result.canManageClub ? '' : 'teams')
          setSelectedTeamIds([])
          setExportSeason('all')
          const historyResult = await loadDataTransferHistory({ clubId: result.club.id })
          if (active) setHistory(historyResult.history || [])
        }
      } catch (requestError) {
        if (active) setError(requestError.message)
      } finally {
        if (active) setScopeBusy(false)
      }
    }
    if (userId) void loadInitialScope()
    return () => { active = false }
  }, [platformMode, userClubId, userId])

  async function runDownload(operation) {
    setActionBusy(operation)
    setError('')
    setNotice('')
    try {
      await downloadDataTransferWorkbook(operation, scopePayload)
      setNotice(operation === 'blank' ? 'Support-assisted portable structure downloaded.' : 'Authorized portable transfer downloaded.')
      await refreshHistory()
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setActionBusy('')
    }
  }

  async function runSimpleTemplateDownload(format) {
    setActionBusy(`simple-template:${format}`)
    setError('')
    setNotice('')
    try {
      await downloadSimpleDataTransferTemplate(format, scopePayload)
      setNotice(`${format.toUpperCase()} player and parent template downloaded.`)
      await refreshHistory()
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setActionBusy('')
    }
  }

  async function runOrdinaryExport() {
    setActionBusy('ordinary-export')
    setError('')
    setNotice('')
    try {
      await downloadOrdinaryDataTransferExport({
        dataset: exportDataset,
        format: exportFormat,
        recordStatus: exportRecordStatus,
        season: exportSeason,
      }, scopePayload)
      const datasetLabel = exportDataset === 'players_and_guardians' ? 'Players and parent contacts' : exportDataset === 'teams' ? 'Teams' : 'Players'
      setNotice(`${datasetLabel} ${exportFormat.toUpperCase()} export downloaded.`)
      await refreshHistory()
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setActionBusy('')
    }
  }

  async function inspectSource() {
    setActionBusy('source-inspect')
    setError('')
    setNotice('')
    clearSourceInspection()
    try {
      const result = await inspectDataTransferSource(file, scopePayload)
      setSourceInspection(result)
      if (!result.portable) applySheetMapping(result.suggestedSheet, result)
      setNotice(result.portable
        ? 'Advanced portable workbook verified. Review options, then prepare the preview.'
        : 'Spreadsheet parsed safely. Confirm the worksheet and column mapping before preview.')
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setActionBusy('')
    }
  }

  async function inspectWorkbook() {
    setActionBusy('inspect')
    setError('')
    setNotice('')
    setInspection(null)
    setSelectedBatch(null)
    setConfirmationPhrase('')
    setConfirmedReview(false)
    try {
      const result = await inspectDataTransferWorkbook(file, {
        ...inspectionPayload,
        mapping: sourceInspection?.portable ? undefined : {
          sheetName: selectedSheetName,
          columns: columnMappings,
          dateConvention,
          defaultTeamId,
          teamMappings,
        },
      })
      setInspection(result)
      setNotice(result.errors?.length ? 'Inspection finished with blocking errors. No records were written.' : 'Preview is ready. No records have been written.')
      await refreshHistory()
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setActionBusy('')
    }
  }

  async function confirmImport() {
    setActionBusy('confirm')
    setError('')
    try {
      const result = await confirmDataTransfer({ ...scopePayload, batchId: inspection.batch.id, confirmationToken: inspection.confirmationToken })
      setNotice(result.result?.idempotent ? 'This confirmed plan had already completed. No duplicate records were created.' : 'The confirmed import completed.')
      setInspection((current) => ({ ...current, batch: { ...current.batch, state: result.result?.state || 'completed' } }))
      await refreshHistory()
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setActionBusy('')
    }
  }

  async function openBatch(batchId) {
    setActionBusy(`details:${batchId}`)
    setError('')
    try {
      const result = await loadDataTransferDetails(batchId, scopePayload)
      setSelectedBatch(result)
      setInspection(null)
      setPreviewFilter('all')
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setActionBusy('')
    }
  }

  async function runRollback() {
    setActionBusy(`rollback:${rollbackBatchId}`)
    setError('')
    try {
      const result = await rollbackDataTransfer(rollbackBatchId, scopePayload)
      setNotice(result.result?.idempotent ? 'This transfer was already rolled back.' : 'Safe rollback completed. The immutable audit history was retained.')
      setRollbackBatchId('')
      setRollbackPhrase('')
      await refreshHistory()
    } catch (requestError) {
      setError(requestError.message)
      await refreshHistory().catch(() => {})
    } finally {
      setActionBusy('')
    }
  }

  return (
    <main className="mx-auto w-full max-w-7xl space-y-6 px-4 py-6 sm:px-6">
      <header className="rounded-xl border border-[#cfe0d6] bg-gradient-to-br from-[#ecfdf5] to-white p-6 shadow-sm">
        <p className="text-xs font-black uppercase tracking-[0.18em] text-[#047857]">Club onboarding</p>
        <h1 className="mt-2 text-3xl font-black tracking-tight text-[#101828]">Data Transfer</h1>
        <p className="mt-3 max-w-3xl text-sm font-semibold leading-6 text-[#52675c]">Bring player and parent data from CSV, TSV, Excel, or OpenDocument spreadsheets. Select a worksheet, map familiar columns, review every proposed change, and confirm separately. Uploading and mapping never write club records. Guardians remain uninvited and no communication is sent.</p>
        <div className="mt-4 flex flex-wrap gap-2 text-xs font-bold text-[#274437]">
          <span className="rounded-full bg-white px-3 py-1 ring-1 ring-[#cfe0d6]">Template {DATA_TRANSFER_TEMPLATE_VERSION}</span>
          <span className="rounded-full bg-white px-3 py-1 ring-1 ring-[#cfe0d6]">Simple {SIMPLE_DATA_TRANSFER_TEMPLATE_VERSION}</span>
          <span className="rounded-full bg-white px-3 py-1 ring-1 ring-[#cfe0d6]">Maximum {Math.round(DATA_TRANSFER_MAX_BYTES / 1024 / 1024)} MB</span>
          <span className="rounded-full bg-white px-3 py-1 ring-1 ring-[#cfe0d6]">CSV, TSV, XLSX, ODS</span>
        </div>
      </header>

      {error ? <div role="alert" className="rounded-lg border border-rose-300 bg-rose-50 px-4 py-3 text-sm font-bold text-rose-900">{error}</div> : null}
      {notice ? <div role="status" className="rounded-lg border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-900">{notice}</div> : null}

      <section className="rounded-xl border border-[#d7e5dc] bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-black text-[#101828]">1. Confirm authorized scope</h2>
            <p className="mt-1 text-sm font-semibold text-[#66756c]">The server derives the final club and team boundary from your signed-in account.</p>
          </div>
          {scope?.club ? <StatusPill value="ready_for_review" /> : null}
        </div>
        {platformMode ? (
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <label className="grid gap-1 text-sm font-black text-[#274437]">Club
              <select value={clubId} onChange={(event) => { setClubId(event.target.value); setScopeMode(''); setSelectedTeamIds([]); setScope(null); clearSourceInspection() }} className="min-h-11 rounded-lg border border-[#b8c9c0] bg-white px-3">
                <option value="">Select a club</option>
                {clubs.map((club) => <option key={club.id} value={club.id}>{club.name}</option>)}
              </select>
            </label>
            <label className="grid gap-1 text-sm font-black text-[#274437]">Support or audit reason
              <input value={auditReason} onChange={(event) => { setAuditReason(event.target.value); setScope(null) }} placeholder="Why this club scope is required" className="min-h-11 rounded-lg border border-[#b8c9c0] px-3" />
            </label>
            <div className="md:col-span-2"><ActionButton disabled={scopeBusy || !clubId || auditReason.trim().length < 10} onClick={() => refreshScope()}>{scopeBusy ? 'Checking scope...' : 'Confirm platform scope'}</ActionButton></div>
          </div>
        ) : null}
        {scope?.club ? (
          <div className="mt-4 space-y-4 rounded-lg border border-[#cfe0d6] bg-[#f7faf8] p-4">
            <div><p className="font-black text-[#101828]">{scope.club.name}</p><p className="mt-1 text-sm font-semibold text-[#52675c]">{scopeMode === 'club' ? `Entire club scope with ${scope.teams.length} existing team${scope.teams.length === 1 ? '' : 's'}` : scopeMode === 'teams' ? `${selectedTeamIds.length} selected team${selectedTeamIds.length === 1 ? '' : 's'}: ${scope.teams.filter((team) => selectedTeamIds.includes(team.id)).map((team) => team.name).join(', ') || 'None selected'}` : 'Choose entire club or selected teams'}</p></div>
            {scope.canManageClub ? <fieldset className="rounded-lg border border-[#cfe0d6] bg-white p-3"><legend className="px-1 text-sm font-black text-[#274437]">Choose transfer scope</legend><div className="mt-2 flex flex-wrap gap-4"><label className="flex items-center gap-2 text-sm font-bold text-[#274437]"><input type="radio" name="data-transfer-scope" checked={scopeMode === 'club'} onChange={() => { setScopeMode('club'); setSelectedTeamIds([]); clearSourceInspection() }} />Entire club</label><label className="flex items-center gap-2 text-sm font-bold text-[#274437]"><input type="radio" name="data-transfer-scope" checked={scopeMode === 'teams'} onChange={() => { setScopeMode('teams'); setAllowTeamCreation(false); clearSourceInspection() }} />Selected teams</label></div></fieldset> : null}
            <fieldset className="rounded-lg border border-[#cfe0d6] bg-white p-3">
              <legend className="px-1 text-sm font-black text-[#274437]">Select import and export teams</legend>
              <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{scope.teams.map((team) => <ChoiceRow key={team.id} id={`data-transfer-team-${team.id}`} disabled={scopeMode !== 'teams'} checked={selectedTeamIds.includes(team.id)} label={team.name} onChange={(event) => { setSelectedTeamIds((current) => event.target.checked ? [...new Set([...current, team.id])] : current.filter((id) => id !== team.id)); clearSourceInspection() }} />)}</div>
              {!scope.teams.length ? <p className="mt-2 text-sm font-semibold text-[#66756c]">No teams exist yet. Choose Entire club to prepare a workbook that creates the first teams.</p> : null}
              <div className="mt-3 flex gap-2"><ActionButton tone="secondary" disabled={scopeMode !== 'teams'} onClick={() => { setSelectedTeamIds(scope.teams.map((team) => team.id)); clearSourceInspection() }}>Select all</ActionButton><ActionButton tone="secondary" disabled={scopeMode !== 'teams'} onClick={() => { setSelectedTeamIds([]); clearSourceInspection() }}>Clear</ActionButton></div>
            </fieldset>
            <div className="grid gap-3 md:grid-cols-2">
              <label className="grid gap-1 text-sm font-black text-[#274437]">Confirmed season<input value={season} onChange={(event) => { setSeason(event.target.value); setInspection(null) }} placeholder="2026/27" className="min-h-11 rounded-lg border border-[#b8c9c0] bg-white px-3" /></label>
              <label className="grid gap-1 text-sm font-black text-[#274437]">Import mode<select value="additive" disabled className="min-h-11 rounded-lg border border-[#b8c9c0] bg-white px-3"><option value="additive">Additive V1</option></select></label>
            </div>
            <div className="grid gap-2 md:grid-cols-2">
              <ChoiceRow id="data-transfer-allow-team-creation" disabled={!scope.canManageTeams || scopeMode !== 'club'} checked={allowTeamCreation} onChange={(event) => { setAllowTeamCreation(event.target.checked); setInspection(null) }} label="Allow team creation" description="Only explicitly mapped missing teams in authorised club-wide scope." />
              <ChoiceRow id="data-transfer-fill-blanks" checked={fillBlankFields} onChange={(event) => { setFillBlankFields(event.target.checked); setInspection(null) }} label="Fill approved blanks" description="Existing populated fields remain unchanged." />
              <ChoiceRow id="data-transfer-update-conflicts" checked={updateConflicts} onChange={(event) => { setUpdateConflicts(event.target.checked); setInspection(null) }} label="Use reviewed spreadsheet values" description="Apply only after reviewing populated-field conflicts in the preview." />
              <ChoiceRow id="data-transfer-create-duplicates" checked={createPossibleDuplicates} onChange={(event) => { setCreatePossibleDuplicates(event.target.checked); setInspection(null) }} label="Create reviewed possible duplicates" description="Create separate records only after duplicate review." />
            </div>
          </div>
        ) : null}
      </section>

      <section className="rounded-xl border border-[#d7e5dc] bg-white p-5 shadow-sm">
        <div>
          <h2 className="text-xl font-black text-[#101828]">2. Export authorised data</h2>
          <p className="mt-2 max-w-3xl text-sm font-semibold leading-6 text-[#66756c]">Choose a readable spreadsheet for everyday use or a separate portable transfer for Footballplayer.online backup, migration, and reimport.</p>
        </div>
        <div className="mt-5 grid gap-5 lg:grid-cols-2">
          <div className="rounded-xl border border-[#b9dfca] bg-[#f7fcf9] p-4">
            <p className="text-xs font-black uppercase tracking-[0.14em] text-[#047857]">Ordinary spreadsheet export</p>
            <h3 className="mt-2 text-lg font-black text-[#101828]">Export spreadsheet</h3>
            <p className="mt-1 text-sm font-semibold leading-6 text-[#52675c]">Create a human-readable file for Google Sheets, Excel, CSV, or OpenDocument. Ordinary exports never include platform references or internal IDs.</p>
            <fieldset className="mt-4">
              <legend className="text-sm font-black text-[#274437]">Dataset</legend>
              <div className="mt-2 grid gap-2">
                <SelectionRow id="data-transfer-export-players" name="data-transfer-export-dataset" value="players" checked={exportDataset === 'players'} onChange={(event) => setExportDataset(event.target.value)} label="Players" description="Player registration fields without parent contact details." />
                <SelectionRow id="data-transfer-export-players-guardians" name="data-transfer-export-dataset" value="players_and_guardians" checked={exportDataset === 'players_and_guardians'} onChange={(event) => setExportDataset(event.target.value)} label="Players and parent contacts" description="Authorised player rows with linked parent or guardian contacts, including any additional contacts in a readable field." />
                <SelectionRow id="data-transfer-export-teams" name="data-transfer-export-dataset" value="teams" checked={exportDataset === 'teams'} onChange={(event) => setExportDataset(event.target.value)} label="Teams" description="Human-readable team and season information." />
              </div>
            </fieldset>
            <fieldset className="mt-4">
              <legend className="text-sm font-black text-[#274437]">File format</legend>
              <div className="mt-2 grid gap-2">
                <SelectionRow id="data-transfer-export-csv" name="data-transfer-export-format" value="csv" checked={exportFormat === 'csv'} onChange={(event) => setExportFormat(event.target.value)} label="CSV" description="Works with Google Sheets and most club systems." />
                <SelectionRow id="data-transfer-export-xlsx" name="data-transfer-export-format" value="xlsx" checked={exportFormat === 'xlsx'} onChange={(event) => setExportFormat(event.target.value)} label="Excel" description="Formatted Microsoft Excel workbook." />
                <SelectionRow id="data-transfer-export-ods" name="data-transfer-export-format" value="ods" checked={exportFormat === 'ods'} onChange={(event) => setExportFormat(event.target.value)} label="OpenDocument" description="For LibreOffice and compatible applications." />
              </div>
            </fieldset>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <label className="grid gap-1 text-sm font-black text-[#274437]">Record status
                <select id="data-transfer-export-status" value={exportRecordStatus} onChange={(event) => setExportRecordStatus(event.target.value)} className="min-h-11 rounded-lg border border-[#b8c9c0] bg-white px-3">
                  <option value="active">Active records</option>
                  <option value="inactive">Inactive records</option>
                  <option value="all">Active and inactive</option>
                </select>
              </label>
              <label className="grid gap-1 text-sm font-black text-[#274437]">Season
                <select id="data-transfer-export-season" value={exportSeason} onChange={(event) => setExportSeason(event.target.value)} className="min-h-11 rounded-lg border border-[#b8c9c0] bg-white px-3">
                  <option value="all">All authorised seasons</option>
                  {exportSeasonOptions.map((value) => <option key={value} value={value}>{value}</option>)}
                </select>
              </label>
            </div>
            <div className="mt-4">
              <ActionButton disabled={!scope?.club || !hasConfirmedScope || Boolean(actionBusy)} onClick={runOrdinaryExport}>{actionBusy === 'ordinary-export' ? 'Preparing export...' : `Download ${exportFormat.toUpperCase()}`}</ActionButton>
            </div>
          </div>
          <div className="rounded-xl border border-[#d7e5dc] bg-white p-4">
            <p className="text-xs font-black uppercase tracking-[0.14em] text-[#52675c]">Advanced option</p>
            <h3 className="mt-2 text-lg font-black text-[#101828]">Portable Footballplayer.online transfer</h3>
            <p className="mt-1 text-sm font-semibold leading-6 text-[#66756c]">Create a structured multi-sheet package for backup, migration, support, or reimport. Footballplayer.online generates the public references that preserve relationships. They are not database IDs and users are not expected to invent them.</p>
            <div className="mt-4 grid gap-2">
              <ActionButton tone="secondary" disabled={!scope?.club || !hasConfirmedScope || Boolean(actionBusy)} onClick={() => runDownload('export')}>{actionBusy === 'export' ? 'Preparing...' : 'Download current portable transfer'}</ActionButton>
              <ActionButton tone="secondary" disabled={!scope?.club || !hasConfirmedScope || Boolean(actionBusy)} onClick={() => runDownload('blank')}>{actionBusy === 'blank' ? 'Preparing...' : 'Download support-assisted blank structure'}</ActionButton>
            </div>
            <p className="mt-3 rounded-lg bg-[#f7faf8] p-3 text-xs font-semibold leading-5 text-[#52675c]">Do not edit generated references unless an approved support workflow specifically requires it. Use an ordinary export when you only need a readable spreadsheet.</p>
          </div>
        </div>
      </section>

      <section className="grid gap-5 lg:grid-cols-2">
        <div className="rounded-xl border border-[#d7e5dc] bg-white p-5 shadow-sm">
          <h2 className="text-xl font-black text-[#101828]">3. Download a simple import template</h2>
          <p className="mt-2 text-sm font-semibold leading-6 text-[#66756c]">The simple player and parent templates contain familiar column names and no platform references or internal IDs.</p>
          <div className="mt-4 flex flex-wrap gap-2">
            {['xlsx', 'csv', 'ods'].map((format) => (
              <ActionButton key={format} disabled={!scope?.club || !hasConfirmedScope || Boolean(actionBusy)} onClick={() => runSimpleTemplateDownload(format)}>
                {actionBusy === `simple-template:${format}` ? 'Preparing...' : `Simple ${format.toUpperCase()}`}
              </ActionButton>
            ))}
          </div>
        </div>

        <div className="rounded-xl border border-[#d7e5dc] bg-white p-5 shadow-sm">
          <h2 className="text-xl font-black text-[#101828]">4. Choose a spreadsheet</h2>
          <p className="mt-2 text-sm font-semibold leading-6 text-[#66756c]">The server validates the real file contents and rejects mismatched, encrypted, macro-enabled, formula-bearing, oversized, or damaged spreadsheets.</p>
          <input type="file" accept={DATA_TRANSFER_ACCEPT} onChange={(event) => { setFile(event.target.files?.[0] || null); clearSourceInspection() }} className="mt-4 block w-full rounded-lg border border-[#b8c9c0] p-3 text-sm font-semibold" />
          {file ? <p className="mt-2 text-xs font-bold text-[#52675c]">{file.name}, {Math.max(1, Math.ceil(file.size / 1024))} KB</p> : null}
          <div className="mt-4"><ActionButton disabled={!scope?.club || !hasConfirmedScope || !file || Boolean(actionBusy)} onClick={inspectSource}>{actionBusy === 'source-inspect' ? 'Reading safely...' : 'Read columns and worksheets'}</ActionButton></div>
        </div>
      </section>

      {sourceInspection ? (
        <section className="rounded-xl border border-[#d7e5dc] bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-xl font-black text-[#101828]">5. Map columns and defaults</h2>
              <p className="mt-1 text-sm font-semibold text-[#66756c]">{sourceInspection.portable ? 'Advanced portable structure verified. Its reference-aware sheets do not need manual mapping.' : `Detected ${sourceInspection.format.toUpperCase()}. Choose one worksheet and confirm how its columns should be used.`}</p>
            </div>
            <span className="rounded-full bg-[#ecfdf5] px-3 py-1 text-xs font-black text-[#047857] ring-1 ring-[#a7d7c0]">{sourceInspection.portable ? 'Portable' : 'Human-readable'}</span>
          </div>

          {!sourceInspection.portable ? (
            <div className="mt-5 space-y-5">
              <label className="grid max-w-xl gap-1 text-sm font-black text-[#274437]">Worksheet
                <select value={selectedSheetName} onChange={(event) => applySheetMapping(event.target.value)} className="min-h-11 rounded-lg border border-[#b8c9c0] bg-white px-3">
                  {sourceInspection.sheets.map((sheet) => <option key={sheet.name} value={sheet.name}>{sheet.name} ({sheet.rowCount} data row{sheet.rowCount === 1 ? '' : 's'})</option>)}
                </select>
              </label>

              {selectedSourceSheet ? (
                <div className="overflow-x-auto rounded-lg border border-[#d7e5dc]">
                  <table className="min-w-full text-left text-sm">
                    <thead className="bg-[#047857] text-white"><tr><th className="px-3 py-2">Source column</th><th className="px-3 py-2">Sample values</th><th className="px-3 py-2">Footballplayer.online field</th><th className="px-3 py-2">Handling</th><th className="px-3 py-2">Default if blank</th></tr></thead>
                    <tbody className="divide-y divide-[#d7e5dc]">
                      {columnMappings.map((mapping, index) => {
                        const suggestion = selectedSourceSheet.mappings.find((candidate) => candidate.sourceColumn === mapping.sourceColumn)
                        return (
                          <tr key={mapping.sourceColumn}>
                            <td className="px-3 py-3"><p className="font-black text-[#101828]">{mapping.sourceColumn}</p><p className="mt-1 text-xs font-bold text-[#66756c]">{suggestion?.confidence || 'unmapped'} suggestion</p></td>
                            <td className="max-w-64 px-3 py-3 text-xs font-semibold text-[#52675c]">{suggestion?.samples?.join(' | ') || 'No sample'}</td>
                            <td className="px-3 py-3">
                              <select aria-label={`Map ${mapping.sourceColumn}`} value={mapping.targetField} onChange={(event) => setColumnMappings((current) => current.map((entry, entryIndex) => entryIndex === index ? { ...entry, targetField: event.target.value, transformation: sourceInspection.fields.find((field) => field.key === event.target.value)?.transformation || 'trim' } : entry))} className="min-h-10 min-w-56 rounded-lg border border-[#b8c9c0] bg-white px-2">
                                <option value="">Ignore this column</option>
                                {sourceInspection.fields.map((field) => <option key={field.key} value={field.key}>{field.label}</option>)}
                              </select>
                            </td>
                            <td className="px-3 py-3">
                              <select aria-label={`Handle ${mapping.sourceColumn}`} disabled={!mapping.targetField} value={mapping.transformation} onChange={(event) => setColumnMappings((current) => current.map((entry, entryIndex) => entryIndex === index ? { ...entry, transformation: event.target.value } : entry))} className="min-h-10 min-w-40 rounded-lg border border-[#b8c9c0] bg-white px-2 disabled:opacity-50">
                                <option value="trim">Trim text</option><option value="normalize_email">Normalise email</option><option value="normalize_phone">Normalise phone</option><option value="parse_date">Parse date</option><option value="split_name">Split full name</option><option value="split_positions">Split positions</option><option value="boolean">Yes or No</option>
                              </select>
                            </td>
                            <td className="px-3 py-3"><input aria-label={`Default for ${mapping.sourceColumn}`} disabled={!mapping.targetField} value={mapping.defaultValue} onChange={(event) => setColumnMappings((current) => current.map((entry, entryIndex) => entryIndex === index ? { ...entry, defaultValue: event.target.value } : entry))} className="min-h-10 w-44 rounded-lg border border-[#b8c9c0] px-2 disabled:opacity-50" /></td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              ) : null}

              {dateDecisionRequired ? (
                <fieldset className="rounded-lg border border-amber-300 bg-amber-50 p-4">
                  <legend className="px-1 text-sm font-black text-amber-950">Confirm ambiguous date order</legend>
                  <p className="mt-1 text-sm font-semibold text-amber-900">Samples: {selectedSourceSheet.ambiguousDateSamples.join(', ')}</p>
                  <div className="mt-3 flex flex-wrap gap-3">
                    <label className="flex cursor-pointer items-center gap-2 rounded-lg bg-white px-3 py-2 text-sm font-black text-amber-950 ring-1 ring-amber-300"><input type="radio" name="data-transfer-date-order" checked={dateConvention === 'dmy'} onChange={() => setDateConvention('dmy')} />Day / Month / Year</label>
                    <label className="flex cursor-pointer items-center gap-2 rounded-lg bg-white px-3 py-2 text-sm font-black text-amber-950 ring-1 ring-amber-300"><input type="radio" name="data-transfer-date-order" checked={dateConvention === 'mdy'} onChange={() => setDateConvention('mdy')} />Month / Day / Year</label>
                  </div>
                </fieldset>
              ) : null}

              {!mappedTargetFields.has('team_name') ? (
                <label className="grid max-w-xl gap-1 text-sm font-black text-[#274437]">Default authorised team
                  <select value={defaultTeamId} onChange={(event) => setDefaultTeamId(event.target.value)} className="min-h-11 rounded-lg border border-[#b8c9c0] bg-white px-3">
                    <option value="">Use the only selected team, or require a decision</option>
                    {scope.teams.filter((team) => scopePayload.clubWideScope || scopePayload.teamIds.includes(team.id)).map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}
                  </select>
                </label>
              ) : null}

              {mappedTargetFields.has('team_name') && selectedSourceSheet?.teamValues?.length ? (
                <div className="rounded-lg border border-[#d7e5dc] bg-[#f7faf8] p-4">
                  <h3 className="font-black text-[#101828]">Team mapping</h3>
                  <p className="mt-1 text-sm font-semibold text-[#66756c]">Exact authorised names are matched automatically. Resolve different names explicitly.</p>
                  <div className="mt-3 grid gap-3 md:grid-cols-2">
                    {teamMappings.map((entry, index) => (
                      <label key={entry.sourceValue} className="grid gap-1 text-sm font-black text-[#274437]">{entry.sourceValue}
                        <select value={entry.create ? '__create__' : entry.teamId} onChange={(event) => setTeamMappings((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, create: event.target.value === '__create__', teamId: event.target.value === '__create__' ? '' : event.target.value } : item))} className="min-h-11 rounded-lg border border-[#b8c9c0] bg-white px-3">
                          <option value="">Auto-match exact name</option>
                          {scope.teams.filter((team) => scopePayload.clubWideScope || scopePayload.teamIds.includes(team.id)).map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}
                          {allowTeamCreation ? <option value="__create__">Create this team at confirmation</option> : null}
                        </select>
                      </label>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}

          {!namesMapped && !sourceInspection.portable ? <p role="alert" className="mt-4 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm font-bold text-amber-950">Map separate player first and last names, or map a full name and keep the confirmed split handling.</p> : null}
          <div className="mt-5">
            <ActionButton disabled={!mappingReady || !season.trim() || Boolean(actionBusy)} onClick={inspectWorkbook}>{actionBusy === 'inspect' ? 'Preparing preview...' : 'Prepare read-only preview'}</ActionButton>
            <p className="mt-2 text-xs font-semibold text-[#66756c]">This stores an audited preview batch and retained raw file. Club players, guardians, teams, and links remain unchanged until the separate final confirmation.</p>
          </div>
        </section>
      ) : null}

      {inspection ? (
        <section className="rounded-xl border border-[#d7e5dc] bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div><h2 className="text-xl font-black text-[#101828]">6. Review preview</h2><p className="mt-1 text-sm font-semibold text-[#66756c]">Batch {inspection.batch.id}, {inspection.batch.format?.toUpperCase()} {inspection.batch.portable ? 'portable' : 'mapped'} import</p></div>
            <StatusPill value={inspection.batch.state} />
          </div>
          {inspection.errors?.length ? (
            <div className="mt-4 rounded-lg border border-rose-300 bg-rose-50 p-4">
              <p className="font-black text-rose-900">{inspection.errors.length} blocking error{inspection.errors.length === 1 ? '' : 's'}</p>
              <ul className="mt-2 space-y-1 text-sm font-semibold text-rose-900">{inspection.errors.slice(0, 20).map((item, index) => <li key={`${item.code}-${item.row}-${index}`}>{item.sheet || 'Workbook'} row {item.row || 'n/a'}: {item.code}, {item.message}</li>)}</ul>
              <div className="mt-3"><ActionButton tone="secondary" onClick={() => downloadDataTransferErrorReport(inspection.batch.id, scopePayload)}>Download error report</ActionButton></div>
            </div>
          ) : null}
          {!inspection.errors?.length && !importFinished ? (
            <div className="mt-5 rounded-lg border border-amber-300 bg-amber-50 p-4">
              <p className="font-black text-amber-950">Final confirmation is separate and irreversible without a safe rollback.</p>
              <div className="mt-3"><ChoiceRow id="data-transfer-confirm-review" checked={confirmedReview} onChange={(event) => setConfirmedReview(event.target.checked)} label="I reviewed the scope and row-level preview" description="Guardian invitations are not sent." /></div>
              <label className="mt-3 grid max-w-sm gap-1 text-sm font-black text-amber-950">Type IMPORT to confirm
                <input value={confirmationPhrase} onChange={(event) => setConfirmationPhrase(event.target.value)} className="min-h-11 rounded-lg border border-amber-400 bg-white px-3" />
              </label>
              <div className="mt-3"><ActionButton disabled={!confirmedReview || confirmationPhrase !== 'IMPORT' || Boolean(actionBusy)} onClick={confirmImport}>{actionBusy === 'confirm' ? 'Importing...' : 'Confirm and import'}</ActionButton></div>
            </div>
          ) : null}
          {importFinished ? <div className="mt-5 rounded-lg border border-emerald-300 bg-emerald-50 p-4 text-sm font-black text-emerald-900">Import completed. Retrying the same confirmed plan is deduplicated by the server.</div> : null}
        </section>
      ) : null}

      {selectedBatch?.batch ? (
        <section className="rounded-xl border border-[#d7e5dc] bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-xl font-black text-[#101828]">Transfer details</h2><p className="mt-1 text-sm font-semibold text-[#66756c]">Batch {selectedBatch.batch.id}</p></div><StatusPill value={selectedBatch.batch.state} /></div>
          {selectedBatch.batch.rollbackBlockedReason ? <p className="mt-4 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm font-bold text-amber-950">Manual review required: {selectedBatch.batch.rollbackBlockedReason}</p> : null}
          {selectedBatch.affectedRecords?.length ? <div className="mt-4 overflow-x-auto"><table className="min-w-full text-left text-sm"><thead className="bg-[#f0f7f3] text-[#274437]"><tr><th className="px-3 py-2">Record type</th><th className="px-3 py-2">Import action</th><th className="px-3 py-2">Public reference</th><th className="px-3 py-2">Rollback state</th></tr></thead><tbody className="divide-y divide-[#d7e5dc]">{selectedBatch.affectedRecords.map((record, index) => <tr key={`${record.entityType}-${record.reference}-${index}`}><td className="px-3 py-2">{record.entityType}</td><td className="px-3 py-2">{record.action}</td><td className="px-3 py-2 font-mono text-xs">{record.reference}</td><td className="px-3 py-2"><StatusPill value={record.rollbackState} /></td></tr>)}</tbody></table></div> : <p className="mt-4 text-sm font-semibold text-[#66756c]">No business records were written by this transfer.</p>}
        </section>
      ) : null}

      {previewRows.length ? (
        <section className="rounded-xl border border-[#d7e5dc] bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-xl font-black text-[#101828]">Row-level results</h2><select value={previewFilter} onChange={(event) => setPreviewFilter(event.target.value)} className="min-h-10 rounded-lg border border-[#b8c9c0] px-3 text-sm font-bold"><option value="all">All outcomes</option>{['create', 'update', 'link', 'unchanged', 'possible_duplicate', 'conflict', 'error', 'warning'].map((value) => <option key={value} value={value}>{value}</option>)}</select></div>
          <div className="mt-4 overflow-x-auto"><table className="min-w-full text-left text-sm"><thead className="bg-[#047857] text-white"><tr><th className="px-3 py-2">Sheet</th><th className="px-3 py-2">Row</th><th className="px-3 py-2">Reference</th><th className="px-3 py-2">Outcome</th><th className="px-3 py-2">Explanation</th><th className="px-3 py-2">Exact field review</th></tr></thead><tbody className="divide-y divide-[#d7e5dc]">{filteredPreview.map((row, index) => <tr key={`${row.sheet || row.sheet_name}-${row.row || row.source_row}-${index}`}><td className="px-3 py-2 font-bold">{row.sheet || row.sheet_name}</td><td className="px-3 py-2">{row.row || row.source_row}</td><td className="px-3 py-2 font-mono text-xs">{row.reference || row.transfer_reference}</td><td className="px-3 py-2"><StatusPill value={row.outcome} /></td><td className="px-3 py-2">{row.explanation}</td><td className="px-3 py-2"><FieldChangeDetails row={row} /></td></tr>)}</tbody></table></div>
        </section>
      ) : null}

      <section className="rounded-xl border border-[#d7e5dc] bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-xl font-black text-[#101828]">Transfer history</h2><p className="mt-1 text-sm font-semibold text-[#66756c]">Immutable status, counts, errors, and rollback outcomes for the authorized scope.</p></div><ActionButton tone="secondary" disabled={!scope?.club || Boolean(actionBusy)} onClick={() => refreshHistory()}>Refresh</ActionButton></div>
        <div className="mt-4 overflow-x-auto"><table className="min-w-full text-left text-sm"><thead className="bg-[#f0f7f3] text-[#274437]"><tr><th className="px-3 py-2">Created</th><th className="px-3 py-2">User</th><th className="px-3 py-2">Type and scope</th><th className="px-3 py-2">File and template</th><th className="px-3 py-2">Outcomes</th><th className="px-3 py-2">Status</th><th className="px-3 py-2">Actions</th></tr></thead><tbody className="divide-y divide-[#d7e5dc]">{history.map((batch) => <tr key={batch.id}><td className="whitespace-nowrap px-3 py-3">{formatDate(batch.created_at)}</td><td className="px-3 py-3"><p className="font-bold">{batch.actor_name}</p><p className="text-xs text-[#66756c]">{batch.actor_role}</p></td><td className="px-3 py-3"><p className="font-bold">{batch.transfer_type}</p><p className="text-xs text-[#66756c]">{batch.scope_label}</p></td><td className="max-w-xs px-3 py-3"><p className="truncate font-bold">{batch.workbook_name}</p><p className="text-xs text-[#66756c]">{batch.template_version}</p>{batch.raw_available ? <p className="text-xs text-[#66756c]">Raw file expires {formatDate(batch.raw_expires_at)}</p> : null}</td><td className="min-w-56 px-3 py-3"><p>{formatCounts(batch.counts)}</p><p className="mt-1 text-xs text-[#66756c]">Errors {(batch.error_summary || []).length}, warnings {(batch.warnings || []).length}</p></td><td className="px-3 py-3"><StatusPill value={batch.state} /></td><td className="px-3 py-3"><div className="flex min-w-48 flex-wrap gap-2"><ActionButton tone="secondary" disabled={Boolean(actionBusy)} onClick={() => openBatch(batch.id)}>Details</ActionButton>{batch.error_summary?.length || batch.warnings?.length ? <ActionButton tone="secondary" onClick={() => downloadDataTransferErrorReport(batch.id, scopePayload)}>Error report</ActionButton> : null}{batch.raw_available ? <ActionButton tone="secondary" onClick={() => downloadDataTransferRawWorkbook(batch.id, batch.workbook_name, scopePayload)}>Raw workbook</ActionButton> : null}{batch.transfer_type === 'import' && ['completed', 'completed_with_warnings', 'rollback_blocked'].includes(batch.state) ? <ActionButton tone="danger" disabled={Boolean(actionBusy)} onClick={() => { setRollbackBatchId(batch.id); setRollbackPhrase('') }}>Rollback</ActionButton> : null}</div></td></tr>)}</tbody></table></div>
        {!history.length ? <p className="mt-4 rounded-lg bg-[#f7faf8] p-4 text-sm font-semibold text-[#66756c]">No transfer history is available for this scope.</p> : null}
      </section>

      {rollbackBatchId ? (
        <section className="rounded-xl border border-rose-300 bg-rose-50 p-5">
          <h2 className="text-lg font-black text-rose-950">Controlled rollback</h2>
          <p className="mt-2 text-sm font-semibold text-rose-900">Rollback is refused if any imported record changed later or gained dependent records. The audit history is never deleted.</p>
          <label className="mt-3 grid max-w-sm gap-1 text-sm font-black text-rose-950">Type ROLLBACK to continue<input value={rollbackPhrase} onChange={(event) => setRollbackPhrase(event.target.value)} className="min-h-11 rounded-lg border border-rose-400 bg-white px-3" /></label>
          <div className="mt-3 flex gap-3"><ActionButton tone="danger" disabled={rollbackPhrase !== 'ROLLBACK' || Boolean(actionBusy)} onClick={runRollback}>Run safe rollback</ActionButton><ActionButton tone="secondary" onClick={() => setRollbackBatchId('')}>Cancel</ActionButton></div>
        </section>
      ) : null}
    </main>
  )
}
