# FP-V1-GAMEDAY-WORKSPACE-SPLIT-02

## Outcome

Green. Game Day now uses compact fixture navigation plus one selected-fixture workspace. Mobile uses a list-first flow where detail replaces the list. Desktop uses a bounded navigation column beside one flexible detail workspace.

No deployment, migration, production business-data mutation, or communication was performed.

## Source gate

| Check | Evidence |
| --- | --- |
| Starting production commit | `8bbee1f36c966f3897ed2f506a998e308559e090` |
| Base commit | `8bbee1f36c966f3897ed2f506a998e308559e090` from `origin/main` |
| Production deploy | Netlify deploy `6a6dfc07a75e680008fd9821`, ready and published from the same commit |
| Production site | `footballplayer-online`, site ID `264c7a36-8b0d-4a35-bedd-9d18482aaf69`, `https://footballplayer.online` |
| Production Supabase | `hvapkizujvsahvgspser`, ACTIVE_HEALTHY, `eu-west-2` |
| Isolated worktree | `E:\Project Manager\Footbal_Development_gameday_workspace_split_02` |
| Branch | `codex/fp-v1-gameday-workspace-split-02` |
| Original checkout | Dirty and left untouched |
| Overlap check | No current Game Day owner found. Historical Game Day branches were stale and not absorbed. |

## Architecture implemented

### Fixture navigation

- Compact summary cards show lifecycle, home or away, fixture type, team and opponent, date, venue, score, availability summary, role warning, and one Manage action.
- Active fixtures keep the existing live-first presentation ordering.
- Next game and List all remain available.
- Previous games remain behind a collapsed disclosure and render compact summaries only.
- No fixture list item renders the full management implementation.

### Selected fixture workspace

- Only one `MatchDayCard` detail workspace is rendered.
- Fixture and section state use `fixture` and `section` query parameters.
- Refresh restores the selected fixture and selected section.
- Fixture-specific safe score drafts remain keyed by fixture and do not leak when switching.
- Mobile hides fixture navigation while a fixture is selected and exposes Back to fixtures.
- Desktop keeps a 20rem fixture navigation column with viewport-bounded vertical scrolling.
- Large player availability lists use a labelled, keyboard-focusable, 32rem bounded region.

### Focused sections

1. Overview: identity, score, timer, period, lifecycle, readiness, parent visibility, primary match actions, essential fixture details, and latest-change signal.
2. Squad and availability: availability totals, player responses, squad decisions, automatic selection warnings, invitations, and selection state.
3. Roles and transport: scorer, referee, linesman, volunteer responses, transport risk, lift needs, lift offers, and staff coordination.
4. Timeline and notes: staff notes, scorer request note, event filters, Event Log, match timeline, correction, and undo access.

Game Mode remains separate and minimal. Its live entry point is available for active matches, and opening it remains read-only until a deliberate match action is selected.

## Page-length measurements

The measurement method matches `FP-V1-PAGE-LENGTH-AUDIT-01`: main content height divided by the effective usable viewport after persistent header obstruction. Measurements used the requested viewports and a local production-aligned fixture runtime through terminal Playwright.

| State | Viewport | Main height | Usable viewport | Effective ratio | Target | Result |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| Before selected fixture | 375 x 812 | 8,705 px | 749 px | 11.62 | N/A | Baseline |
| After fixture-list default | 375 x 812 | 940 px | 748 px | 1.26 | 2.00 or below | Pass |
| After selected Overview | 375 x 812 | 1,864 px | 748 px | 2.49 | 2.50 or below | Pass |
| After selected Overview | 1440 x 900 | 1,355 px | 798 px | 1.70 | 2.00 or below | Pass |
| After fixture-list default | 768 x 1024 | 923 px | 922 px | 1.00 | Below 4.00 | Pass |
| After selected Overview | 768 x 1024 | 1,435 px | 922 px | 1.56 | Below 4.00 | Pass |

- Mobile selected Overview reduction from 11.62 to 2.49: **78.57 percent**.
- Mobile fixture-list reduction from 11.62 to 1.26: **89.16 percent**.
- Desktop selected-fixture reduction from 6.15 to 1.70: **72.36 percent**.
- No measured default state exceeds 4.00 effective screens.
- Horizontal overflow: none at 375 x 812, 768 x 1024, or 1440 x 900.

## Before and after density

Before, the selected mobile document could combine the route summary, duplicate cockpit, fixture list, full selected management, Game Mode entry, score controls, timeline, readiness, overview, notes, Event Log, availability, squad decisions, transport, roles, upcoming fixtures, and previous games in one continuous page.

After, the default mobile document shows only compact fixture navigation. A selected mobile fixture shows its top score and action summary plus one focused section. Desktop shows compact navigation and one selected workspace simultaneously, with the navigation column bounded independently.

## Capabilities preserved

- Fixture creation entry points, ordering, live-first ordering, upcoming fixtures, and previous games.
- Score display and editing, timer, pause integrity, lifecycle, custom duration, extra time, conclusion rules, penalty goals, shootouts, regulation and shootout score separation, and hydration.
- Game Mode, staff scoring, accepted parent scorer authority, Game Mode return, and match-history access.
- Availability responses, squad decisions, automatic selection warnings, invited-player management, player selection, scorer, referee and linesman requests, and volunteer selection.
- Parent visibility, transport replies, lift needs, lift offers, transport risk, staff chase list, notes, Event Log filters, timeline, readiness, exports, and final report.
- Existing club, team, role and permission gates, Parent Portal behaviour, calendar integration, light theme, dark theme, mobile navigation, desktop navigation, and PWA behaviour.

No authentication, role, database, communication, payment, Calendar, Parent Portal, or parent-scorer authority semantics were changed.

## Validation

| Gate | Result |
| --- | --- |
| Focused Game Day non-database tests | 315 passed, 0 failed |
| Focused Game Day tests including database coverage | 323 passed, 0 failed |
| Adjacent Match Day, scorer, availability, fixture, calendar, Parent Portal, navigation and permission tests | 610 passed, 0 failed |
| Full repository Node test sweep | 1,771 passed, 0 failed, 2 skipped across 245 files |
| Terminal Playwright | Passed mobile, tablet, desktop, dark mode, URL restoration, browser back flow, fixture switching, per-fixture safe draft state, Game Mode entry and return, responsive overflow, and screenshot capture |
| Communication during browser testing | None. Email, invitation, push and SMS requests remained zero. |
| Business-data mutation during browser testing | None. Fixture-backed reads and local security analytics were intercepted locally. |
| Touched-file lint | Passed |
| Production build | Passed, 432 modules transformed |
| PWA | Passed, service worker generated with 121 precache entries |
| Live build environment check | Passed for Supabase project reference |
| Parent access regression lock | Passed for source and production build |
| Local validation deployment safety | Passed. Main not involved and production trigger unavailable. |

## Zero-Regression Gate

Green.

- Every existing Game Day capability remains reachable through the selected workspace or separate Game Mode.
- Staff and accepted-parent-scorer authority remains unchanged.
- Club and team scoping remains in the existing domain layer.
- Availability and squad decisions remain separate.
- Transport remains in the staff-only workspace.
- Parent visibility and Parent Portal behaviour are unchanged.
- Extra-time, penalty, timer, lifecycle, event history, previous games, Calendar and export regressions pass.
- No production request, production mutation, communication, deployment, migration, or unrelated source change was introduced.

## Remaining long states

- Squad and availability can contain many players. The player list is bounded to 32rem with independent keyboard-accessible scrolling.
- Timeline can grow with match history. The existing timeline keeps its initial three-event disclosure and Show all behaviour, while Event Log filters remain available.
- Roles and transport can become longer when many players require follow-up. It is isolated from the default Overview and groups risk, coordination and role detail into one dedicated section.
- The Final Match Report can be long when explicitly opened for a completed fixture. It remains an intentional selected-fixture report state and is not part of the default document.

## Visual evidence

Mobile:

- `docs/audits/FP-V1-GAMEDAY-WORKSPACE-SPLIT-02-screenshots/mobile-fixture-list-initial.png`
- `docs/audits/FP-V1-GAMEDAY-WORKSPACE-SPLIT-02-screenshots/mobile-fixture-list-lower.png`
- `docs/audits/FP-V1-GAMEDAY-WORKSPACE-SPLIT-02-screenshots/mobile-selected-overview.png`
- `docs/audits/FP-V1-GAMEDAY-WORKSPACE-SPLIT-02-screenshots/mobile-squad-availability.png`
- `docs/audits/FP-V1-GAMEDAY-WORKSPACE-SPLIT-02-screenshots/mobile-roles-transport.png`
- `docs/audits/FP-V1-GAMEDAY-WORKSPACE-SPLIT-02-screenshots/mobile-timeline-notes.png`

Desktop:

- `docs/audits/FP-V1-GAMEDAY-WORKSPACE-SPLIT-02-screenshots/desktop-navigation-selected-workspace.png`
- `docs/audits/FP-V1-GAMEDAY-WORKSPACE-SPLIT-02-screenshots/desktop-selected-overview.png`
- `docs/audits/FP-V1-GAMEDAY-WORKSPACE-SPLIT-02-screenshots/desktop-roles-transport-dark.png`

## Release state

- Production deployment: No
- Migration: None
- Production data mutation: None
- Communication: None
- In-app browser used: No
- Recommended release action: Review commit, merge it to `main`, then allow the normal production Netlify deploy from that exact merged commit. After deploy, run read-only responsive Game Day smoke checks against the production commit without changing real fixture data.
