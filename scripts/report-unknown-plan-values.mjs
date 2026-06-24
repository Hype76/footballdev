import process from 'node:process'
import { createClient } from '@supabase/supabase-js'
import { normalizePlanKey } from '../src/lib/plans.js'

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !serviceRoleKey) {
  console.error('Set SUPABASE_URL or VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to report stored plan values.')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: {
    persistSession: false,
  },
})

const planColumns = [
  { table: 'clubs', column: 'plan_key', select: 'id,name,plan_key' },
  { table: 'club_owner_invites', column: 'plan_key', select: 'id,club_id,plan_key,status' },
  { table: 'tester_access_codes', column: 'plan_key', select: 'id,code,label,plan_key,is_active' },
  { table: 'stripe_checkout_records', column: 'plan_key', select: 'id,club_id,customer_email,plan_key,plan_status' },
]

function normalizeRow(row, column) {
  const value = row?.[column]

  return {
    ...row,
    canonicalPlanKey: normalizePlanKey(value),
    isKnownPlanKey: Boolean(normalizePlanKey(value)),
  }
}

async function loadTablePlanValues({ table, column, select }) {
  const { data, error } = await supabase
    .from(table)
    .select(select)
    .order('id', { ascending: true })

  if (error) {
    return {
      table,
      column,
      error: error.message,
      rows: [],
      unknownRows: [],
    }
  }

  const rows = (data ?? []).map((row) => normalizeRow(row, column))
  const unknownRows = rows.filter((row) => !row.isKnownPlanKey)

  return {
    table,
    column,
    totalRows: rows.length,
    unknownRowCount: unknownRows.length,
    unknownRows,
  }
}

const results = await Promise.all(planColumns.map(loadTablePlanValues))
const unknownRowCount = results.reduce((sum, result) => sum + Number(result.unknownRowCount ?? 0), 0)

console.log(JSON.stringify({
  checkedAt: new Date().toISOString(),
  modifiedData: false,
  unknownRowCount,
  results,
}, null, 2))

process.exitCode = unknownRowCount > 0 ? 1 : 0
