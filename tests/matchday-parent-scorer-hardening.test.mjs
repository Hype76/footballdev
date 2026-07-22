import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  getMatchDayLifecycleState,
  getParentScorerTimerActions,
} from "../src/lib/matchday-lifecycle.js";
import { formatMatchTimerClock } from "../src/lib/matchday-timer.js";

const migrationPath = new URL(
  "../supabase/migrations/20260722084618_fp_v1_gameday_prematch_parity_harden_03.sql",
  import.meta.url,
);
const domainPath = new URL("../src/lib/domain/match-day.js", import.meta.url);
const parentPagePath = new URL(
  "../src/pages/ParentPortalPage.jsx",
  import.meta.url,
);

function getExportedFunctionSource(source, functionName) {
  const start = source.indexOf(`export async function ${functionName}`);
  assert.notEqual(start, -1);
  const nextExport = source.indexOf("\nexport ", start + 1);
  return source.slice(start, nextExport === -1 ? source.length : nextExport);
}

test("parent scorer migration separates score, goal, and lifecycle mutation", async () => {
  const migration = await readFile(migrationPath, "utf8");

  assert.match(
    migration,
    /create or replace function public\.current_user_is_match_day_scorer/i,
  );
  assert.match(
    migration,
    /create or replace function public\.set_match_day_timer_state/i,
  );
  assert.match(migration, /current_user_is_match_day_scorer\(match_row\.id\)/i);
  assert.match(migration, /role_assignment\.club_id = match_row\.club_id/i);
  assert.match(migration, /role_assignment\.team_id = match_row\.team_id/i);
  assert.match(migration, /parent_link\.status = 'active'/i);
  assert.match(migration, /match_day\.concluded_at is null/i);
  assert.match(
    migration,
    /Lifecycle changes require an explicit Match Day clock action\./i,
  );
  assert.match(migration, /Start the match before recording a goal\./i);

  const scoreFunction =
    migration.match(
      /create or replace function public\.update_match_day_score_as_scorer[\s\S]*?comment on function public\.update_match_day_score_as_scorer/i,
    )?.[0] || "";
  const goalFunction =
    migration.match(
      /create or replace function public\.add_match_day_goal_as_scorer[\s\S]*?comment on function public\.add_match_day_goal_as_scorer/i,
    )?.[0] || "";

  assert.doesNotMatch(scoreFunction, /set\s+status\s*=/i);
  assert.doesNotMatch(scoreFunction, /timer_started_at\s*=/i);
  assert.doesNotMatch(
    goalFunction,
    /update public\.match_days[\s\S]*?set[\s\S]*?\bstatus\s*=/i,
  );
  assert.doesNotMatch(goalFunction, /timer_started_at\s*=/i);
  assert.match(
    migration,
    /revoke all on function public\.set_match_day_timer_state\(uuid, text\) from public, anon/i,
  );
  assert.match(
    migration,
    /revoke all on function public\.apply_match_day_timer_action[\s\S]*authenticated, service_role/i,
  );
  assert.match(migration, /Parent views are read-only for event undo\./i);
});

test("parent scorer application uses explicit timer RPC and Game Mode open is local-only", async () => {
  const [domain, parentPage] = await Promise.all([
    readFile(domainPath, "utf8"),
    readFile(parentPagePath, "utf8"),
  ]);

  const scoreFunction = getExportedFunctionSource(
    domain,
    "updateMatchDayScoreAsScorer",
  );
  const timerFunction = getExportedFunctionSource(
    domain,
    "setParentScorerMatchDayTimerState",
  );

  assert.doesNotMatch(scoreFunction, /status_value/);
  assert.match(timerFunction, /supabase\.rpc\('set_match_day_timer_state'/);
  assert.match(parentPage, /Open Game Mode/);
  assert.match(
    parentPage,
    /Opening this view does not start or change the match\./,
  );
  assert.match(
    parentPage,
    /onToggleGameMode=\{\(\) => setScorerGameModeMatchId/,
  );
  assert.doesNotMatch(parentPage, /onToggleGameMode[\s\S]{0,120}supabase\.rpc/);
  assert.match(parentPage, /matchMutationRef\.current\.has\(matchId\)/);
  assert.match(parentPage, /!match\.isScorer \? \(/);
  assert.doesNotMatch(
    parentPage,
    /<span[^>]*>Status<\/span>[\s\S]{0,300}<select/,
  );
});

test("parent scorer lifecycle controls expose only deliberate actions for the current state", () => {
  const ready = { status: "scheduled", timerStatus: "not_started" };
  const running = { status: "live", timerStatus: "running" };
  const halfTime = { status: "half_time", timerStatus: "half_time" };
  const fullTime = { status: "full_time", timerStatus: "full_time" };
  const concluded = { ...fullTime, concludedAt: "2026-07-22T10:00:00Z" };

  assert.equal(formatMatchTimerClock(ready), "0:00");
  assert.equal(getMatchDayLifecycleState(ready), "not_started");
  assert.deepEqual(getParentScorerTimerActions(ready), [
    { action: "start", label: "Start match" },
  ]);
  assert.deepEqual(
    getParentScorerTimerActions(running).map((item) => item.action),
    ["pause", "hydration", "half_time", "full_time"],
  );
  assert.deepEqual(getParentScorerTimerActions(halfTime), [
    { action: "resume", label: "Start second half" },
  ]);
  assert.deepEqual(
    getParentScorerTimerActions(fullTime).map((item) => item.action),
    ["resume", "conclude"],
  );
  assert.deepEqual(getParentScorerTimerActions(concluded), []);
});
