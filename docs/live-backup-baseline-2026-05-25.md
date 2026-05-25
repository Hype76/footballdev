# Live Backup Baseline

Created: 2026-05-25T17:15:17+01:00

Purpose: record the live rollback baseline before the football club operating system rebuild starts.

## Hard Boundary

- Do not deploy this rebuild to the production Netlify context.
- Do not write to the live Supabase project.
- Rebuild work must use the staging Netlify branch/site and the test Supabase project.

## Netlify Live Baseline

- Site name: footballplayer-online
- Site ID: 264c7a36-8b0d-4a35-bedd-9d18482aaf69
- Production URL: https://footballplayer.online
- Current live deploy ID: 6a117b83944c6f59e2e3f096
- Current live deploy state: ready
- Current live deploy context: production
- Current live deploy published at: 2026-05-23T10:04:30.638Z
- Current live deploy permalink: https://6a117b83944c6f59e2e3f096--footballplayer-online.netlify.app
- Current live deploy SSL URL: https://footballplayer.online
- Current staging deploy URL for this live deploy: https://6a117b83944c6f59e2e3f096.staging.footballplayer.online

## Supabase Live Baseline

- Live project name: FootballDev
- Live project ref: hvapkizujvsahvgspser
- Live database host: db.hvapkizujvsahvgspser.supabase.co
- Live region: eu-west-2
- Live project status: ACTIVE_HEALTHY
- Live Postgres version: 17.6.1.104
- PITR enabled: false
- WAL-G enabled: true

Completed physical backups visible before rebuild:

- 2026-05-25T03:57:54.183Z, status COMPLETED
- 2026-05-24T03:57:02.182Z, status COMPLETED
- 2026-05-23T03:56:23.930Z, status COMPLETED
- 2026-05-22T03:54:08.829Z, status COMPLETED
- 2026-05-21T03:55:13.088Z, status COMPLETED
- 2026-05-20T03:53:40.641Z, status COMPLETED
- 2026-05-19T03:55:29.445Z, status COMPLETED
- 2026-05-18T03:53:54.494Z, status COMPLETED

## Test Supabase Target

- Test project name: FootballDev Test
- Test project ref: llpufwzvgxyczxcjwupu
- Test database host: db.llpufwzvgxyczxcjwupu.supabase.co
- Test region: eu-west-2
- Test project status: ACTIVE_HEALTHY
- Local `.env.local` and `.env.staging` point at this test project.

## Backup Note

The Supabase CLI available in this workspace exposes `supabase backups list` and `supabase backups restore`, but not a command to create an immediate physical backup. The latest completed live physical backup at the time of this baseline is 2026-05-25T03:57:54.183Z.

