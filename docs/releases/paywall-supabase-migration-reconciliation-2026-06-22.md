# Paywall Supabase Migration Reconciliation

Date: 2026-06-22 08:00:08 +01:00

Reference: FP-PAYWALL-SUPABASE-16

Status: Green

## 1. Original Blocker

FP-PAYWALL-PROD-RETRY-15 stopped before production migration or deploy because:

```text
supabase db push --dry-run --linked
```

failed before it could prove that only the two approved paywall migrations would apply.

The cause was Supabase migration history drift:

- Production had remote migration versions absent from the clean release branch.
- The clean release branch had local migration versions absent from production before the approved paywall migrations.

No production migration, production data change, Netlify deploy, Stripe change, environment edit, subscription migration, customer announcement, staging cleanup, or `football-os-staging` use occurred in this reconciliation task.

## 2. Production Supabase Ref

Production ref: `hvapkizujvsahvgspser`

Project name: `FootballDev`

Known backup from the previous gate: `2026-06-22T03:56:11.220Z`

The clean worktree link was verified with:

```text
supabase/.temp/project-ref = hvapkizujvsahvgspser
```

## 3. Local Branch And Commit

Worktree: `E:/Project Manager/Footbal_Development_paywall_release`

Branch: `codex/paywall-release`

Starting HEAD: `475998b999a2991e70be5cd777bbc5e079477c6e`

Remote branch: `origin/codex/paywall-release`

The starting HEAD matched the expected blocker-result commit.

## 4. Remote Applied Migration Versions

Read-only sources used:

- `supabase migration list --linked`
- Supabase connector `list_migrations`
- Read-only query against `supabase_migrations.schema_migrations`

Remote production applied versions confirmed:

```text
20260416100633, 20260416100703, 20260416101245, 20260416142153, 20260416142416, 20260416144509, 20260416162000, 20260416170000, 20260416181500, 20260420113000, 20260420124500, 20260421100000, 20260421112000, 20260421114500, 20260421123000, 20260421131500, 20260422113000, 20260424153000, 20260424165000, 20260424172500, 20260424185000, 20260424190500, 20260424192500, 20260424194500, 20260424202000, 20260424213000, 20260424221000, 20260424223000, 20260424224500, 20260424231000, 20260424233000, 20260424235900, 20260425001000, 20260425002500, 20260425004000, 20260427120000, 20260428100000, 20260429100000, 20260429110000, 20260429123000, 20260429124500, 20260429130500, 20260429132000, 20260429153000, 20260429154500, 20260501100000, 20260501113000, 20260503171500, 20260503174000, 20260503180500, 20260503190000, 20260503193000, 20260505120000, 20260505133000, 20260506110000, 20260507102000, 20260507124500, 20260507150000, 20260507162000, 20260507171000, 20260507180000, 20260507193000, 20260507195500, 20260508114500, 20260508133000, 20260508133301, 20260508141000, 20260508152000, 20260509120000, 20260510103000, 20260511161000, 20260511172000, 20260511183000, 20260511190000, 20260511193000, 20260511194500, 20260511203000, 20260511204500, 20260511210000, 20260511213000, 20260511220000, 20260511221000, 20260516135000, 20260516165000, 20260516193000, 20260516200000, 20260516203000, 20260516210000, 20260516213000, 20260516214500, 20260516220000, 20260516221500, 20260516223000, 20260516224500, 20260516232000, 20260518143000, 20260518153000, 20260518184500, 20260519103000, 20260519120000, 20260519123000, 20260519124500, 20260519133000, 20260519133500, 20260519134000, 20260519150000, 20260519162000, 20260519183000, 20260519193000, 20260519203000, 20260519204500, 20260519210000, 20260519211500, 20260519213000, 20260519214500, 20260519215500, 20260520120000, 20260608133523, 20260609093224, 20260609104500, 20260611103005, 20260611125348, 20260611132359, 20260611142459, 20260611160114, 20260612094748, 20260613071232, 20260614030401, 20260614030531, 20260614031148, 20260616051157, 20260616062006, 20260616072046, 20260616091650, 20260616091722, 20260616153836, 20260616163613, 20260616165423, 20260616170649
```

## 5. Local Migration Versions Before Reconciliation

Before reconciliation, local files included the production-applied history, these remote-drift equivalents under different local timestamps, older local-only migrations, and the two approved paywall migrations.

Remote versions missing locally:

```text
20260608133523
20260611125348
20260611132359
20260611160114
20260612094748
20260613071232
20260614030401
20260614030531
20260614031148
20260616051157
20260616062006
20260616072046
20260616091650
20260616091722
20260616153836
20260616163613
20260616165423
20260616170649
```

Local versions missing remotely:

```text
20260521120000
20260521123000
20260525161630
20260527093802
20260527095014
20260528075951
20260528103000
20260528110834
20260528111741
20260531162038
20260608130710
20260609165720
20260611123101
20260611130844
20260611155049
20260613065704
20260613071942
20260613120000
20260614031058
20260616050750
20260616055708
20260616070626
20260616085824
20260616085834
20260616153314
20260616162746
20260616175500
20260616181000
20260617085000
20260617191000
20260617193000
20260618103000
20260622043000
20260622050850
```

## 6. Missing Migration Versions And Recovery Sources

The exact remote-version filenames were not present in Git history. The production `supabase_migrations.schema_migrations` records included names and statement records for each missing version. The local release branch had matching migration contents under different timestamps. The reconciliation therefore used the trusted local file body and renamed it to the production-applied version recorded in Supabase.

| Remote version | Production name | Recovered from local file |
| --- | --- | --- |
| `20260608133523` | `calendar_events` | `20260608130710_calendar_events.sql` |
| `20260611125348` | `scope_form_fields_to_team` | `20260611123101_scope_form_fields_to_team.sql` |
| `20260611132359` | `add_assessment_session_arrival_time` | `20260611130844_add_assessment_session_arrival_time.sql` |
| `20260611160114` | `allow_cancelled_assessment_sessions` | `20260611155049_allow_cancelled_assessment_sessions.sql` |
| `20260612094748` | `club_owner_invites` | `20260528075951_club_owner_invites.sql` |
| `20260613071232` | `20260613065704_harden_email_send_events_rls` | `20260613065704_harden_email_send_events_rls.sql` |
| `20260614030401` | `20260613071942_plan_b_matchday_availability_prereq` | `20260613071942_plan_b_matchday_availability_prereq.sql` |
| `20260614030531` | `20260613120000_parent_calendar_visibility_controls` | `20260613120000_parent_calendar_visibility_controls.sql` |
| `20260614031148` | `20260614031058_harden_parent_portal_rpc_execute_grants` | `20260614031058_harden_parent_portal_rpc_execute_grants.sql` |
| `20260616051157` | `harden_match_days_staff_select_scope` | `20260616050750_harden_match_days_staff_select_scope.sql` |
| `20260616062006` | `20260616055708_private_assessment_drafts` | `20260616055708_private_assessment_drafts.sql` |
| `20260616072046` | `20260616070626_harden_parent_portal_cleanup` | `20260616070626_harden_parent_portal_cleanup.sql` |
| `20260616091650` | `default_assessment_scores_10_point` | `20260616085824_default_assessment_scores_10_point.sql` |
| `20260616091722` | `repair_evaluation_drafts_creator_rls` | `20260616085834_repair_evaluation_drafts_creator_rls.sql` |
| `20260616153836` | `repair_manual_review_eval_matchday` | `20260616153314_repair_manual_review_eval_matchday.sql` |
| `20260616163613` | `harden_evaluation_draft_close_lifecycle` | `20260616162746_harden_evaluation_draft_close_lifecycle.sql` |
| `20260616165423` | `allow_creator_evaluation_draft_close` | `20260616175500_allow_creator_evaluation_draft_close.sql` |
| `20260616170649` | `allow_creator_evaluation_draft_lifecycle_select` | `20260616181000_allow_creator_evaluation_draft_lifecycle_select.sql` |

## 7. Files Restored Or Changed

Active migration history changes:

- Renamed 18 timestamp-drifted migration files to match production-applied versions.
- Left the two approved paywall migrations in `supabase/migrations` as pending local migrations.
- Moved 14 local-only, not-production-applied files out of `supabase/migrations` into `supabase/archived-migrations/not-applied-production`.

Source references updated:

- Tests that assert migration SQL now read the reconciled active filenames or the archived not-production-applied records.
- Historical paywall audit and planning docs now point to the reconciled or archived path where they referenced moved files.

## 8. Approved Paywall Migrations Still Pending

These remain the only local migrations absent from production:

```text
20260622043000_paywall_plan_key_foundation.sql
20260622050850_paywall_server_enforcement.sql
```

No approved paywall migration file body was changed.

## 9. Dry-run Result

After the active migration directory was reconciled, the safe dry-run command was run:

```text
supabase db push --dry-run --linked
```

Result:

```text
DRY RUN: migrations will not be pushed to the database.
Would push these migrations:
 - 20260622043000_paywall_plan_key_foundation.sql
 - 20260622050850_paywall_server_enforcement.sql
```

A later dry-run retry temporarily hit a Supabase CLI temp-role authentication error and asked for `SUPABASE_DB_PASSWORD`. This was not a migration ordering failure. After waiting, the final dry-run passed again and showed only the same two approved paywall migrations.

A safe migration-list comparison also showed:

```text
REMOTE_ONLY
LOCAL_ONLY
20260622043000
20260622050850
```

## 10. Whether Only Approved Paywall Migrations Would Apply

Yes.

The reconciled active `supabase/migrations` directory now matches production-applied migration versions plus the two approved pending paywall migrations.

## 11. Remaining Blockers

No Supabase migration-history blocker remains for the controlled paywall production retry.

Remaining release gates from the earlier runbook still apply:

- Steve must approve the actual production migration execution.
- Stripe live Products, Prices, and webhook configuration still need final approved verification.
- Development Club checkout must remain demo-request gated unless a real live Price ID is approved.
- No `supabase db push` without `--dry-run` has been run in this task.

## 12. Validation Results

| Command | Result |
| --- | --- |
| `git status --short` | Dirty only with intended reconciliation files before commit |
| `git branch -vv` | Current branch `codex/paywall-release` |
| `git log --oneline --decorate -n 30` | Starting HEAD `475998b` confirmed |
| `supabase projects list -o json` | Production ref `hvapkizujvsahvgspser` linked and active healthy |
| `supabase migration list --linked` | Passed after reconciliation and showed only paywall migrations as local-only |
| `supabase db push --dry-run --linked` | Passed after reconciliation and showed only the two approved paywall migrations |
| Final `supabase db push --dry-run --linked` retry | Passed and again showed only the two approved paywall migrations |
| `npm.cmd run build` | Passed |
| Paywall test suite | Passed, 37 of 37 |
| `npm.cmd run test:platform` | Passed, 102 of 102 after path updates |
| `npm.cmd run test:v1-stabilise` | Passed, 47 of 47 after path updates |
| `npm.cmd run check:local-live-validation-safety` | Passed |
| `git diff --check` | Passed |

## 13. Final Recommendation

Green: Supabase migration gate cleared for the next controlled production retry.

The next retry can safely re-run:

```text
supabase migration list --linked
supabase db push --dry-run --linked
```

Expected dry-run output:

```text
Would push these migrations:
 - 20260622043000_paywall_plan_key_foundation.sql
 - 20260622050850_paywall_server_enforcement.sql
```

If Supabase CLI temp-role auth fails again, Steve should either wait and retry once, or provide `SUPABASE_DB_PASSWORD` through a secret-safe local environment path. Do not run production `supabase db push --linked` until Steve explicitly approves production migration execution.
