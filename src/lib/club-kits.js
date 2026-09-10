export const KIT_TYPES = ['home', 'away']
export const KIT_SHIRT_PATH = 'M18 5 27 2c2 5 8 5 10 0l9 3 15 14-10 10-6-5v36H19V24l-6 5L3 19Z'
export function kitLabel(type) { return type === 'away' ? 'Away kit' : type === 'home' ? 'Home kit' : 'Kit to be confirmed' }
export function normalizeClubKit(row = {}) {
  return { colour: /^#[0-9a-f]{6}$/i.test(row.colour || '') ? row.colour : '#1d4ed8', imagePath: row.image_path || null }
}
export async function readClubKits(client, clubId) {
  if (!clubId) return {}
  const { data, error } = await client.from('club_kits').select('kit_type,colour,image_path').eq('club_id', clubId)
  if (error) throw error
  return Object.fromEntries((data || []).map(row => [row.kit_type, normalizeClubKit(row)]))
}
export function kitImageUrl(client, kit) {
  return kit?.imagePath ? client.storage.from('club-kits').getPublicUrl(kit.imagePath).data.publicUrl : ''
}
