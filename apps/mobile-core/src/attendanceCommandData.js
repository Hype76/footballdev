import { supabase } from './supabase'

export async function prepareAttendanceChoices(choices) {
  const positions = choices.map((choice, index) => choice ? index : -1).filter(index => index >= 0)
  const prepared = Array(choices.length).fill(null)
  // Read-only preparation occurs during resource loading, never during a choice press.
  for (let offset = 0; offset < positions.length; offset += 200) {
    const indexes = positions.slice(offset, offset + 200)
    const { data, error } = await supabase.rpc('prepare_mobile_attendance_choices', { choices_value: indexes.map(index => choices[index]) })
    if (error) return prepared // Existing synchronous behaviour remains available until server contract is installed.
    indexes.forEach((index, position) => { prepared[index] = data?.[position] || null })
  }
  return prepared
}

export async function executeAttendanceCommand(command) {
  const { route, target, baseline } = command.preparation
  const { data, error } = await supabase.rpc('apply_mobile_attendance_command', {
    command_id_value: command.id, route_value: route, target_value: target,
    expected_value: baseline, response_value: command.response,
  })
  if (error) throw error
  return data
}
