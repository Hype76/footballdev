# Paywall Migration Fix

Date: 2026-06-22 08:22:06 +01:00

Reference: FP-PAYWALL-MIGRATION-FIX-18

Status: Green

## 1. Original Migration Failure

The final controlled production release stopped before Netlify deploy because the first approved paywall migration failed during production apply:

```text
20260622043000_paywall_plan_key_foundation.sql
SQLSTATE 42P13
cannot change name of input parameter "feature_name"
```

The failed function was:

```text
public.can_use_plan_feature(uuid, text)
```

Read-only production inspection showed the existing function argument names were:

```text
target_club_id, feature_name
```

The pending migration attempted to replace the same function signature with:

```text
target_club_id, feature_key
```

PostgreSQL rejected that because `CREATE OR REPLACE FUNCTION` cannot rename an existing input parameter.

## 2. Fix Applied

The pending migration files were fixed in place because neither has been recorded as applied in production migration history.

Changed files:

- `supabase/migrations/20260622043000_paywall_plan_key_foundation.sql`
- `supabase/migrations/20260622050850_paywall_server_enforcement.sql`

Both files now preserve the existing production parameter name:

```sql
create or replace function public.can_use_plan_feature(target_club_id uuid, feature_name text)
```

The function bodies now read from `feature_name`.

No `DROP FUNCTION` was added. No migration filename changed. No production follow-up migration was created.

## 3. Same-Class Function Review

Read-only production metadata was checked for the function signatures touched by the two pending paywall migrations:

- `can_use_plan_feature(uuid, text)`
- `can_insert_team_for_plan(uuid)`
- `can_insert_player_for_plan(uuid, text, text)`
- `can_insert_staff_invite_for_plan(uuid, text)`
- `can_insert_evaluation_for_plan(uuid)`
- `enforce_club_plan_update_features()`
- `normalize_subscription_plan_key(text)`
- `can_insert_staff_for_plan(uuid)`

Findings:

- `can_use_plan_feature(uuid, text)` was the only existing function with a pending input-parameter rename mismatch.
- Existing production functions touched by the second migration retained their existing argument names and return types.
- `normalize_subscription_plan_key(text)` and `can_insert_staff_for_plan(uuid)` do not currently exist in production and are new in the pending migration path.
- No return type or argument type mismatch was found in the pending paywall migration review.

## 4. Dry-Run Result

The first safe dry-run after the local fix hit the known Supabase CLI temp-role authentication issue:

```text
failed SASL auth
Connect to your database by setting the env var: SUPABASE_DB_PASSWORD
```

No migration SQL was reached in that failed dry-run attempt.

After a short wait, a fresh safe dry-run passed:

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

Only the two approved paywall migrations would apply. No unexpected historical migrations appeared.

## 5. Validation

| Check | Result |
| --- | --- |
| `git status --short` before edits | Clean |
| `git branch -vv` | Current branch `codex/paywall-release` |
| HEAD before edits | `f4b574f11fe8c69113bfdde30c413aa58bc7eeba` |
| Production function metadata read | `can_use_plan_feature(uuid,text)` uses `feature_name` |
| Static pending SQL scan | No remaining `can_use_plan_feature` input parameter named `feature_key` |
| `supabase migration list --linked` | Only `20260622043000` and `20260622050850` local-only |
| `supabase db push --dry-run --linked` | Passed on retry and showed only the two approved migrations |
| `npm.cmd run build` | Passed |
| Paywall test suite | Passed, 37 of 37 |
| `npm.cmd run test:platform` | Passed, 102 of 102 |
| `npm.cmd run test:v1-stabilise` | Passed, 47 of 47 |
| `npm.cmd run check:local-live-validation-safety` | Passed |

## 6. Production Changes

No production migration was applied.

No Netlify deploy occurred.

No Stripe object, price, webhook, or environment variable was changed.

No subscription migration, customer repricing, customer announcement, staging cleanup, or production data change occurred.

## 7. Remaining Blockers

Production migration execution still needs explicit approval before the next release retry.

Stripe live object verification remains the accepted Amber condition from the release gate because secrets are masked.

Development Club checkout must remain demo-request gated until a real approved live Price ID exists.

## 8. Final Recommendation

Green: the migration fix is ready for the next controlled production migration and deploy retry.

Before retrying production, rerun:

```text
supabase migration list --linked
supabase db push --dry-run --linked
```

Proceed only if the dry-run still shows exactly:

```text
20260622043000_paywall_plan_key_foundation.sql
20260622050850_paywall_server_enforcement.sql
```
