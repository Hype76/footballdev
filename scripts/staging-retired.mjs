const commandName = process.argv[2] || 'staging command'

console.error(`${commandName} is retired. V1 staging and its test Supabase project have been decommissioned.`)
console.error('Use production-only V1 validation unless a new isolated staging environment is explicitly approved.')
process.exit(1)
