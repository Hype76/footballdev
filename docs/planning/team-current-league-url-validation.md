# Proposed current league URL: validation and permission plan

Status: local implementation prepared, not released. The draft remains unapplied. On 05:10:2026 it was executed only in an isolated synthetic PGlite fixture; no live database was accessed. Simon accepted one optional URL per team and Team Admin editing in Slack message `1791050697.416769`, approved the delivered viewer mockups and requested an off switch in `1791055992.074399`. Existing failed gates remain unresolved.

The date alignment fix stays in commit `ad765d81325124b85f461025fcd8fc8b52360f83` on branch `codex/simon-fixture-league-20261003`. This proposal is a separate follow-on branch, `codex/team-league-url-draft-20261003`, based on that commit.

## Accepted choices and placement recommendation

- One optional current league website URL per team, separate from the existing league name.
- Team Admins edit. The existing trusted team-management helper also allows Club Admins without team assignments; the draft now adds an explicit same-team rank-50 assignment requirement to both the setter and direct-write trigger. Club Admin status alone does not grant editing. A Club Admin with that Team Admin assignment can edit. Coaches below Team Admin rank can view only. Platform Admin editing is excluded by the existing helper.
- Edit in existing web Team Management and a compact Team section in Coach Settings, restricted to Team Admins.
- Coaches: a "Current league" row first in the existing Home list, above "Next Calendar item", labelled with the selected team. Hide in club-wide context or when no URL is set.
- Parents and Players: a "Current league" row directly below the Home action buttons, above "Next up", labelled with the active player's team. It is a sibling of the player switcher, not a nested action inside its Pressable. Switching the active player changes the link. Hide when there is no team or URL.
- The approved row opens the external league website after a fresh scoped read. The local implementation uses the existing Home styling and compact Settings rows, without new boxed mobile panels. It refreshes on Home entry and app foreground, and rejects stale responses during account/team/player switches, including A to B to A.
- Team Admins can save the URL and the "Show league link" switch together. Turning it off retains the saved URL and hides the viewer row for Coaches, Parents and Players. An empty URL also hides the row. New teams default to off; no backfill is proposed.
- Parents and Players can view their currently authorised team. Ordinary Fans are excluded from this request.
- No Match Day capability requirement: this is team information. Existing app access and plan gates continue to govern entry to screens.

## Draft schema and API

SQL: `supabase/migration-drafts/20261003175613_team_current_league_url_draft.sql`. Supabase CLI generated the migration name; the file was moved outside active migrations to prevent accidental application.

Adds nullable `teams.league_url` and non-null `teams.league_link_enabled` default false. Existing teams default to null/off without backfill; `teams.league`, official names, fixtures, calendar recurrence and email queues are unchanged. Whitespace-only client input clears the URL. The database constraint allows at most 2048 characters, HTTP or HTTPS, valid ASCII hostname labels and optional valid port/path/query/fragment. It rejects credentials in the authority, backslashes, whitespace/control characters and other schemes. The implemented URL parser converts IDNs to ASCII; IPv6 literals are not supported by this draft.

- `get_team_league_url(team_id_value)`: active Coach/team access using trusted minimum rank 20; returns team ID/name, visibility and stored editing authority. Only assigned Team Admins receive the saved URL while off; other Coaches receive null.
- `set_team_league_url(team_id_value, url_value, enabled_value)`: trusted minimum rank 50, exact same-team assignment/club checks and row locking. Updates URL, visibility and existing editor metadata; adds one audit event containing only previous/current presence and visibility, avoiding URL query credentials in audit metadata.
- `get_parent_player_team_league_url(link_id_value, link_type_value)`: derives team and club from the selected, owned active Parent link or accepted Player connection. Returns team ID/name, visibility and URL only when enabled. It does not accept a caller-selected team ID. Parent authority and Player owner/scope helpers remain authoritative. The actual mobile Player profile uses linkType fan plus relationshipType player; the adapter maps that shape to this Player RPC branch and excludes ordinary Fans.
- A private trigger enforces Team Admin authority on direct writes to either field. Existing table grants and RLS policies are not broadened or replaced. Blank/null/off default inserts and unchanged fields retain existing behaviour.
- Private helpers are not directly executable by client roles. Public RPCs use the repository's guarded SECURITY DEFINER pattern, fixed empty search paths, explicit account/relationship checks and authenticated-only execution. Account deletion/ban is checked against stored Auth state, not user metadata.

No URL is fetched by the server. The local UI validates with the platform URL parser, opens the external browser only after a user action and fresh access/visibility check, and reports browser errors without logging the full URL. It never renders URL content as HTML or automatically opens links. Link state is not persisted to offline caches or queues; offline rows hide. Edits respect existing client plan access in addition to stored server editing authority.

## Required isolated database tests, not yet executed

After explicit authorisation to run synthetic database tests, use the existing PGlite permission harness pattern and then a disposable Supabase environment. Neither stage may target production.

| Scenario | Expected result |
| --- | --- |
| Existing teams, generic team insert, unrelated team update | Null URL; existing behaviour retained |
| Valid HTTPS and HTTP; mixed-case scheme; path/query/fragment; ports 1 and 65535 | Save and exact readback |
| Null, empty or whitespace-only input | Clear to null; authorised editor only |
| JavaScript/data/file schemes, relative URL, missing host, credentials, embedded whitespace/control characters, over 2048 characters, ports 0 and 65536 | Reject atomically; no editor/audit changes |
| Team Admin rank 50 on assigned team, including a Club Admin with that assignment | Set, replace and clear allowed |
| Club Admin without a qualifying Team Admin assignment | Read allowed; setter and direct URL writes denied |
| Coach rank 20 on assigned team | Read allowed; RPC and direct insert/update URL writes denied |
| High rank in another team; guessed team ID; forged client role or user metadata | Denied; no URL disclosure or writes |
| Missing/inactive membership, revoked team assignment, suspended staff, archived/inactive team or club | Denied |
| Anonymous, missing Auth identity, deleted/banned Auth account, service-role request without approved actor | Denied; explicit RPC grants verified |
| Owned active Parent link A; another account's link; stale team link; mismatched team club | Only A's exact current team readable; other cases denied/empty |
| Parent with two players in different clubs; suspended staff in club A but valid Parent relationship in club B | Selected relationship respected; independent club B Parent access retained |
| Accepted Player connection; ordinary Fan; revoked connection; revoked inviting Parent link; inactive Player | Only active Player relationship readable; denied otherwise |
| Player moves teams or link changes during request | Current authorised team only; previous team URL must not persist in client cache |
| Parent/Player direct URL write and setter RPC, including attempts to clear | Denied |
| Invalid update or failed audit insert | Whole transaction rolls back |
| Concurrent replace/clear; direct table update; seeded insert with URL | No privilege bypass; row locking and trigger checked; direct writes may require a future audit trigger decision |
| Migration application and schema-cache reload in disposable environment | APIs compile, grants match, existing teams-returning RPCs remain compatible |

Confirm the current helper definitions and archived/suspended semantics from the full migration lineage. Tests must exercise real helpers and RLS, not only stubbed ranks. Cover relationship revocation, team movement and foreign-club data inconsistencies explicitly.

## Local checks completed, database checks still blocked

`tests/team-league-link.test.mjs`: 26 passes for URL validation, relationship adapters, scope keys, off/clear payloads, safe opening and request gates. SQL assertions are static only, not permission or compilation proof.

`tests/team-league-link-browser.mjs`: actual Coach/Parent/Player Home components and the native/web editors with synthetic RPCs only. Verifies approved placements, off retaining URL, clear/empty/invalid URLs, failed save retaining draft after retry, stored read-only authority, account/team changes, A to B to A stale replies, offline hiding, revoked access, browser errors and context changes while opening. Viewer layout checks cover 320/390 widths in light/dark themes and 44px minimum touch targets. No external requests or database SQL execution.

The local web build and both offline mobile web exports pass. Existing grouped unit regressions: 194 passes, two failures reproduced on untouched main (Parent calendar-safety source assertion and Coach on-behalf copy assertion). Six dual-access browser scenarios pass. Full database-dependent CI and permission correctness remain unverified under the instruction not to execute SQL.

External-browser evidence: Simon reported "It works in safari." in Slack `1791058788.528499` at 20:19 UTC on 03:10:2026, after the FA Full-Time link was blocked in the in-app browser. This completes the normal-browser comparison as a customer-reported Safari result. The exact Cloudflare trigger remains unknown; this is not proof of device/browser-wide compatibility. Retain external-browser opening in future physical-device QA, including the supplied FA Full-Time and GotSport links. No implementation or release change was requested by this evidence update.

Retain the date-fix regression, Parent Match Day scorer/availability/carpool tests, calendar recurrence and privacy tests, email queue tests and login/dual-access checks. Run required CI, security, migration reconciliation and mobile export gates. Focused passes do not establish full regression safety or physical-device receipt.

## Risks and release conditions

The complete draft parses and executes under an authenticated role in a synthetic PGlite fixture with explicit authority and billing seams. It verifies blocked and NULL billing rejection for setter/direct field writes, server can_edit, URL/visibility preservation, audit count and removed-assignment denial. These tests do not establish full-schema RLS, Parent/Player SQL isolation, concurrency or migration compatibility. The UI requires the proposed RPCs before it can display or edit links; current schema RPC absence fails closed. External links can become stale or contain private query tokens; no availability check is proposed. Existing broad team read policies may expose stored URL/visibility columns to other already authorised direct table readers; the viewer RPCs suppress disabled links and add no broad grants, but exact allowed audiences need isolated verification.

Any runtime or migration ordering incompatibility is a blocker. Before moving the draft into active migrations, rebase on current main, regenerate its timestamp with the CLI and reconcile the approved migration manifest. Repair existing failures without waivers: the braces supply-chain advisory, migration reconciliation gate, baseline Parent calendar-safety assertion and Coach on-behalf copy assertion. Product placement approval is not release approval.

Rollback before UI shipping: revoke/drop the three new RPCs (setter now takes uuid/text/boolean), trigger, private helpers and constraint, then drop only `teams.league_url` and `teams.league_link_enabled` if their data has been retained as required. Never drop the existing `teams.league` column. After UI shipping, hide the action and maintain API compatibility before any destructive rollback. This is a plan, not an executed operation.

## Combined candidate validation on 05:10:2026

The feature is integrated into the owned V1 candidate. Both editors are keyed by exact account/team/authority scope; the link hook invalidates old sessions during layout cleanup. Staff mutation billing must be explicitly allowed in the setter, direct-write trigger and server can_edit. The league unit and synthetic SQL checks pass 29/29 with zero skips. Actual Coach/Parent/Player Home and native/web editor browser checks pass, including stale replies, off retaining URL, placement and failed save recovery. The fixture alignment browser passes 72 checks. Historical branch results above are not current-head release approval. The SQL remains in migration-drafts. Security qualification, complete real-schema permission evidence and physical-device checks remain required.
