# FP-V1-TEAM-RESOURCES-SQL-REVIEW-12

Controlled SQL review only. No production mutation.

## Summary

This review reconstructs the parked Team Resources player-link and explicit parent-sharing database change against the production schema dump at `C:/Users/pulse/AppData/Local/Temp/fp-prod-schema-public.sql`.

Outcome: Amber. The original parked migration was recovered, but it is not safe to run as written because it depends on `public.parent_portal_links`, which does not exist in production. The production-safe parent visibility path is `public.parent_player_links`.

No SQL was executed. No production data was read beyond the schema-only dump. No deploy was made.

## Context

- Reference: FP-V1-TEAM-RESOURCES-SQL-REVIEW-12
- Production URL: https://footballplayer.online
- Netlify site: footballplayer-online
- Netlify site ID: `264c7a36-8b0d-4a35-bedd-9d18482aaf69`
- Production deploy ID: `6a4cf0bf620ee18860475899`
- Supabase production ref: `hvapkizujvsahvgspser`
- Worktree: `E:/Project Manager/Footbal_Development_team_resources_safe_live_09`
- Branch: `codex/fp-v1-team-resources-safe-live-09`
- Commit: `15f2e3f4b7de3bbd6e6593295d5adf2f7ea1674a`

## Source Evidence

The original migration was found at:

`E:/Project Manager/Footbal_Development_matchday_minimal_tools_01/supabase/migrations/20260707090000_resource_library_external_links_parent_visibility.sql`

Git history confirms:

- Added by commit `66f4fb93ececfa1b4b696268a4cb79dbf802eb4e`
- Deleted by commit `15f2e3f4b7de3bbd6e6593295d5adf2f7ea1674a`

The related parked app and test files from the original candidate were:

- `src/lib/domain/resource-library.js`
- `src/pages/ResourceLibraryPage.jsx`
- `src/pages/ParentPortalPage.jsx`
- `src/components/parent-portal/ParentPortalShell.jsx`
- `src/components/players/PlayerAssignedResources.jsx`
- `tests/resource-library-parent-links.test.mjs`

## Recovered Original Migration

The recovered SQL added:

- `resource_library_items.resource_type`
- `resource_library_items.external_url`
- `resource_library_links.parent_visible`
- `resource_library_links_parent_visible_player_idx`
- `public.get_parent_portal_player_resources(uuid)`

Unsafe dependency found:

```sql
from public.parent_portal_links parent_link
...
where parent_link.id = parent_link_id_value
  and parent_link.user_id = auth.uid()
  and parent_link.revoked_at is null;
```

Production does not have `public.parent_portal_links`, `user_id`, or `revoked_at` in that shape. The migration must not be executed as recovered.

## Production Schema Facts

Confirmed from the schema-only dump:

- `public.resource_library_items` exists.
- `public.resource_library_links` exists.
- `public.resource_library_items` has RLS enabled.
- `public.resource_library_links` has RLS enabled.
- Existing resource-library policies exist for staff select, manager insert, and manager update.
- Existing resource-library grants expose `SELECT, INSERT, UPDATE` on both resource tables to `authenticated`.
- Existing helper functions include `current_user_can_view_resource_library`, `current_user_can_manage_resource_library`, `resource_library_player_in_scope`, `resource_library_link_target_allowed`, and archive/remove RPCs.
- `public.parent_player_links` exists.
- Parent access RPCs already use `public.parent_player_links`.
- `public.current_user_can_access_parent_link(uuid, uuid)` exists.
- `public.current_user_can_access_parent_player(uuid)` exists.
- `public.current_user_can_access_parent_team(uuid)` exists.
- Parent portal RPCs for match days and shared calendar events exist.

Missing from production:

- `public.parent_portal_links`
- `public.get_parent_portal_player_resources(uuid)`
- `public.resource_library_items.resource_type`
- `public.resource_library_items.external_url`
- `public.resource_library_links.parent_visible`
- `resource_library_links_parent_visible_player_idx`

## Parent Visibility Path

Recommended path: `public.parent_player_links`.

This is safe because production already uses it as the parent-child source of truth:

- Parent identity: `parent_player_links.auth_user_id = auth.uid()`
- Active parent access: `parent_player_links.status = 'active'`
- Linked child: `parent_player_links.player_id`
- Club scope: `parent_player_links.club_id`
- Optional team scope: `parent_player_links.team_id`

Cross-child access is denied by requiring `resource_library_links.linked_id = parent_player_links.player_id`.

Cross-club access is denied by requiring `resource_library_links.club_id = parent_player_links.club_id`, and then joining `resource_library_items` on the same `club_id`.

Staff-only resources remain hidden by requiring `resource_library_links.parent_visible is true`. Existing staff policies remain unchanged.

## SQL Plan

Draft SQL artifact:

`docs/planning/fp-v1-team-resources-sql-review-12.draft.sql`

The draft avoids the original direct-column approach for external links because production already has file-oriented constraints on `resource_library_items.storage_path`. Instead, it proposes an additive side table:

`public.resource_library_external_links`

This avoids weakening the existing storage-path check and keeps existing file resources intact.

Drafted changes:

- Add `resource_library_links.parent_visible boolean not null default false`.
- Add a partial parent-visible player index.
- Add `resource_library_external_links` with RLS, explicit grants, and URL checks.
- Add parent-visible RLS policies on `resource_library_items` and `resource_library_links`.
- Add `create_external_resource_library_item(...)` RPC for future app code.
- Add `get_parent_portal_player_resources(uuid)` RPC using `parent_player_links`.
- Revoke function execution from `public` and `anon`.
- Grant execution only to `authenticated` and `service_role`.

Important: the draft uses `rollback;` at the end as an extra reminder that this file is not for direct execution.

## RLS And Policy Review

Existing staff policies must remain:

- `resource_library_items_select_staff`
- `resource_library_items_insert_manager`
- `resource_library_items_update_manager`
- `resource_library_links_select_staff`
- `resource_library_links_insert_manager`
- `resource_library_links_update_manager`

New parent policies should be additive:

- `resource_library_items_select_parent_visible`
- `resource_library_links_select_parent_visible`
- `resource_library_external_links_select_scoped`
- `resource_library_external_links_insert_manager`
- `resource_library_external_links_update_manager`

Do not replace existing staff policies unless a later verification proves a named conflict.

## Verification Queries

Do not run these until Steve approves execution.

```sql
select column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public'
  and table_name in ('resource_library_items', 'resource_library_links', 'resource_library_external_links')
order by table_name, ordinal_position;

select tablename, rowsecurity
from pg_tables
where schemaname = 'public'
  and tablename in ('resource_library_items', 'resource_library_links', 'resource_library_external_links');

select policyname, tablename, cmd, roles, qual, with_check
from pg_policies
where schemaname = 'public'
  and tablename in ('resource_library_items', 'resource_library_links', 'resource_library_external_links')
order by tablename, policyname;

select grantee, table_name, privilege_type
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name in ('resource_library_items', 'resource_library_links', 'resource_library_external_links')
order by table_name, grantee, privilege_type;

select p.proname, pg_get_functiondef(p.oid)
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('get_parent_portal_player_resources', 'create_external_resource_library_item');

select count(*) as resource_item_count
from public.resource_library_items;

select count(*) as parent_visible_link_count
from public.resource_library_links
where parent_visible is true;
```

Functional verification requires a non-production-safe fixture or an approved rollback-only production probe. It must prove:

- Staff-only resource links are not returned by `get_parent_portal_player_resources`.
- Parent-visible links require `parent_visible is true`.
- Parent-visible links require `linked_type = 'player'`.
- Parent-visible links require a matching active `parent_player_links` row.
- Cross-child access is denied.
- Cross-club access is denied.

## App Code Dependency Review

The original parked app code must not be restored verbatim until the approved SQL shape is final.

Files that need restoring or adapting later:

- `src/lib/domain/resource-library.js`
- `src/pages/ResourceLibraryPage.jsx`
- `src/pages/ParentPortalPage.jsx`
- `src/components/parent-portal/ParentPortalShell.jsx`
- `src/components/players/PlayerAssignedResources.jsx`
- `tests/resource-library-parent-links.test.mjs`

Required app changes versus the original parked code:

- Replace direct `resource_type` and `external_url` column assumptions with either the approved RPC response or the additive `resource_library_external_links` side table.
- Use `create_external_resource_library_item(...)` for external links if the additive side-table plan is approved.
- Keep parent portal resource reads RPC-only.
- Keep the parent Resources UI hidden until schema verification passes.
- Update the static test to expect `parent_player_links.auth_user_id` and `status = 'active'`, not `parent_portal_links.user_id` and `revoked_at`.

## Risks

- Migration history remains mismatched, so normal `supabase db push` remains unsafe.
- The original migration uses a missing table and cannot be executed.
- The additive external-link plan needs app code changes because the recovered app code expected direct columns on `resource_library_items`.
- The draft SQL has not been run against production or a restored clone.
- Supabase and Google connectors were previously token-expired, so live connector verification and Activity Log update may still be blocked.

## Stop Conditions

Stop before any execution if:

- Target ref is not `hvapkizujvsahvgspser`.
- `supabase db dump --schema public --linked` no longer matches the reviewed object shapes.
- `public.parent_player_links` is absent or its access columns differ.
- Any SQL plan references `public.parent_portal_links`.
- Any plan grants parent resource access to `anon`.
- Any plan removes existing staff policies or weakens resource-library staff scoping.
- Any dry-run or verification shows migration history drift that would invoke unapproved migrations.
- Backup or restore proof is missing.
- Steve has not explicitly approved the final SQL text.

## Future Execution Prompt Draft

Reference: FP-V1-TEAM-RESOURCES-CONTROLLED-SQL-EXECUTION

Project: Footballplayer.online V1

Mode: Approved controlled SQL execution, schema verification, app restore, test, and deploy

Goal:
Execute only the Steve-approved SQL from `docs/planning/fp-v1-team-resources-sql-review-12.draft.sql` after replacing the draft header and `rollback;` with an execution-safe wrapper. Then verify schema, RLS, grants, and parent visibility before restoring app code or deploying.

Required preflight:

- Confirm worktree, branch, and commit.
- Confirm production ref is `hvapkizujvsahvgspser`.
- Confirm retired staging ref is not used.
- Confirm backup and restore proof are available.
- Confirm Steve approved the exact SQL text.
- Confirm no production emails or payment flows will be touched.

Execution boundaries:

- Do not run `supabase db push`.
- Do not run migration repair.
- Do not apply any unapproved SQL.
- Do not deploy until DB verification passes.
- Do not mutate application data except the approved schema changes.

Execution steps:

1. Capture fresh schema-only dump.
2. Verify reviewed object shapes still match.
3. Apply only approved SQL.
4. Run verification queries for columns, RLS, policies, grants, functions, indexes, and row counts.
5. Run parent visibility probes only with approved rollback-only fixtures or approved non-production clone.
6. Restore adapted app code.
7. Run resource, parent portal, Match Day, sidebar, fixture management, role permission, and route tests.
8. Build.
9. Deploy only after all gates pass.
10. Verify production bundle and safe parent-resource route behavior.
11. Report migration-history debt separately.

Required report:

- SQL applied: yes/no
- Production ref
- Backup proof
- Schema verification
- Parent visibility verification
- Tests/build
- Deploy ID
- Production mutation summary
- Emails sent: none
- Stripe/payment touched: no
- Known regressions
- Activity Log update status

## Approval Points

Steve must approve:

- Whether to use the additive side-table external-link model.
- Whether to expose parent resources through the RPC-only path first.
- Whether external links may be stored through `create_external_resource_library_item(...)`.
- Whether controlled SQL execution may proceed despite unresolved migration-history debt.
- Whether production rollback-only probes are allowed, or whether a restored clone is required.

## Recommended Next Action

Review the draft SQL with Steve. If approved, run a separate controlled execution prompt that starts with backup and fresh schema proof, applies only the approved SQL, verifies DB access controls, then restores and adapts the parked app code.
