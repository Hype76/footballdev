# Backup and recovery assurance runbook

Reference: `FP-V1-SECURITY-M3-SUPPLY-GOVERNANCE-ASSURANCE-IMPLEMENT-01`

Finding closed in candidate: `FP-SPR-019`

## Current read-only provider baseline

Captured on 2026-07-21 before candidate changes:

- Supabase project `FootballDev`, ref `hvapkizujvsahvgspser`, status `ACTIVE_HEALTHY`.
- Organization plan `pro`, region `eu-west-2`, Postgres `17.6.1.104` on Postgres 17.
- Latest production migration `20260721161858_m2_database_function_and_club_logo_hardening`.
- Daily completed physical backups were visible from 2026-07-14 through 2026-07-21. Latest completed backup: 2026-07-21T03:54:06.427Z.
- WAL-G enabled. PITR disabled.
- Production database inventory: 77 public tables, 190 public routines, 159 public policies and 77 RLS-enabled public tables.
- Aggregate counts: 61 Auth users, 5 Storage buckets, 41 Storage objects, 9 clubs, 23 teams, 99 players, 36 user profiles, 19,435 audit logs, 5,291 record backups, 24 staff invites, 35 parent links and 13 data transfer batches.
- The retired project ref is absent from the accessible project inventory and from the restore artifacts.

PITR and longer recovery granularity remain a provider decision. The current source candidate is ready, but overall production posture remains Amber until the approved provider configuration and release closure task.

## Non-production restore drill evidence

Drill date: 2026-07-21.

Because a Supabase branch would incur provider cost and carries no production data, the approved fallback used a current logical backup restored into an isolated local PostgreSQL 17 container.

Steps completed:

1. Linked the isolated worktree locally to the production project using the existing approved database credential. No provider configuration changed.
2. Created read-only logical schema and data dumps for `public` and `app_private` only.
3. Restored the schema and 41,599,639-byte data dump into an isolated local PostgreSQL 17 container with triggers disabled only for the data load to accommodate circular and external managed-schema references.
4. Verified exact source and restored counts for all 77 public tables, 190 routines, 159 policies, 77 RLS tables and the listed critical business aggregates.
5. Verified matching definition digests for active authority, membership authority, user authority, platform club deletion, platform team deletion and demo recovery fingerprint functions.
6. Applied candidate migration `20260721211500_m3_security_monitoring_assurance` to the restored database.
7. Verified business and audit row counts unchanged, public routines increased from 190 to 193, policies reduced from 159 to 158 by removal of direct authenticated audit insert, and all three candidate functions existed.
8. Executed the audit RPC and read-only monitor RPC against the restored database. Actor derivation and nested redaction passed.
9. Verified 0 invalid indexes, 0 unvalidated constraints and no authenticated insert, update or delete grant on `audit_logs`.
10. Removed the local container, both temporary dump files and temporary provider link state.

Privacy-safe dump fingerprints recorded before destruction:

- Schema SHA-256: `845B2C633D2A693BAC7EB1BF372A83C91CE9ABB2B457B22E2A13126A37E87577`
- Data SHA-256: `DD32441EDCFD933DC56711DD3A6B36CBE19029CB973E7828D63F3C39CE2ED1C8`

No row value, token, credential or personal record was displayed or retained as evidence.

## Recovery scope by system

Database backup does not recover every service component.

| Component | Recovery source | Validation |
| --- | --- | --- |
| Public and private database schemas and data | Supabase physical backup, PITR when enabled, or approved logical backup | Migration ledger, table and row aggregates, routines, policies, RLS, critical function digests |
| Supabase Auth users and Auth configuration | Provider-managed Auth recovery and separately exported configuration evidence | Aggregate user count, provider settings, redirect allowlist, MFA and email provider configuration |
| Supabase Storage objects | Storage object inventory and separate object backup process | Bucket and object counts, object path digest, sample authorized retrieval without exposing content |
| Netlify deploy artifacts | Git commit, Git-built artifact, Deploy Preview and retained deploy | Site ID, deploy ID, commit SHA, artifact manifest, function count |
| Netlify environment | Provider environment configuration | Names-only inventory and approved secret recovery source, never values in Git or reports |
| GitHub source and governance | GitHub repository and protected remote mirror | Commit and tag inventory, ruleset, required checks, collaborators and CODEOWNERS |
| DNS and TLS | Netlify managed DNS and registrar account | Zone, custom domains, TLS state and recovery ownership |
| Schedules | Source function config and Netlify deploy metadata | Function names, cron expressions, native schedule authentication |

Current Netlify environment names are `NODE_VERSION`, `RESEND_API_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `SUPABASE_SERVICE_ROLE_KEY`, `VITE_APP_URL`, `VITE_PAYMENTS_DISABLED`, the four Stripe price IDs, `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_SUPABASE_URL`, `VITE_WEB_PUSH_PUBLIC_KEY`, `WEB_PUSH_PRIVATE_KEY`, `WEB_PUSH_PUBLIC_KEY` and `WEB_PUSH_SUBJECT`. Values must come from the approved secret manager or provider recovery path.

## Recovery objectives

Current database RPO: up to 24 hours while only daily physical backups are available.

Target database RPO: 15 minutes after approved PITR enablement and provider confirmation.

Target database RTO: 4 hours for database service restoration and validation.

Target full-service RTO: 8 hours for database, Auth, Storage, Netlify, environment, schedules, DNS and browser verification.

If entitlement or approval prevents PITR, retain the 24-hour RPO as Amber and record the explicit business acceptance.

## Incident recovery order

1. Declare the incident owner, scope, time window and communication channel.
2. Freeze deploys, migrations, destructive provider actions and retention jobs.
3. Preserve current deploy, database, log and provider evidence without exposing secrets.
4. Choose the last known good recovery point and confirm backup completion.
5. Restore into a provider branch or isolated non-production target first.
6. Validate migration ledger, schemas, counts, critical function digests, RLS, policies, authority and invitation controls.
7. Recover Auth configuration and verify aggregate user state.
8. Recover Storage objects and verify bucket and object fingerprints.
9. Restore Netlify environment from the approved secret source and build the exact Git commit.
10. Validate functions, schedules, CSP, PWA, desktop and mobile browser behavior.
11. Validate DNS and TLS, then authorize traffic cutover.
12. Monitor errors, denials, audit thresholds and business counters.
13. Record final evidence and decisions in the shared Activity Log.

## Roll-forward and rollback

Prefer roll-forward after a clean non-production restore and migration validation. If a candidate migration fails, discard the non-production target and restart from the same backup. Never edit applied migration history.

Production rollback requires an approved restore point, confirmed data-loss window, incident owner and business approval. Restore into production only through the provider recovery flow. Re-deploy the exact last known good Git commit after database compatibility is confirmed.

## Test schedule

- Monthly: verify latest completed backup, PITR state, region, database version, migration ledger and Storage inventory.
- Quarterly: perform a non-production restore drill and compare privacy-safe fingerprints.
- After authority, invitation, data transfer or retention schema changes: rerun the focused recovery drill before release.
- Annually: test full-service recovery including Auth, Storage, Netlify environment, schedules and DNS with named owners.

## Release provider decisions

1. Approve PITR for the production project and select the retention window supported by the Pro plan.
2. Approve a separate Storage object backup location and retention policy.
3. Name the Auth, Netlify environment and DNS recovery owners.
4. Approve quarterly drill timing and evidence retention.

No purchase, plan change, PITR enablement, restore or production mutation was performed by this implementation.
