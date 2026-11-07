import assert from 'node:assert/strict'
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, copyFileSync, rmSync } from 'node:fs'
import { execFileSync, spawnSync } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { hardeningMigrationScope, matchesHardeningMigrationScope, completeV1MigrationScope, matchesCompleteV1MigrationScope, incidentRecoveryMigrationScope, matchesIncidentRecoveryMigrationScope } from '../scripts/v1-hardening-migration-scope.mjs'

test('held no-wait migration preserves both command bodies apart from the contested row lock', () => {
 const candidate = readFileSync('supabase/migrations/20261107151218_coach_match_day_command_no_wait.sql', 'utf8').replaceAll('\r\n', '\n')
 const inputs = [
  ['supabase/migrations/20260907112202_coach_match_day_offline_commands.sql', 'apply_coach_match_day_command'],
  ['supabase/migrations/20261004153000_matchday_unconfigured_participant_roster.sql', 'apply_coach_match_day_command_v2'],
 ]
 const body = (source, name) => {
  const start = source.indexOf('create or replace function public.' + name + '(')
  assert.ok(start >= 0)
  const opening = source.indexOf('as $$', start)
  const closing = source.indexOf('$$;', opening + 5)
  assert.ok(opening > start && closing > opening)
  return source.slice(opening + 5, closing)
 }
 const originalLock = 'select * into m from public.match_days where id = match_day_id_value for update;'
 for (const [file, name] of inputs) {
  const original = body(readFileSync(file, 'utf8').replaceAll('\r\n', '\n'), name)
  assert.equal(original.split(originalLock).length, 2)
  assert.equal(body(candidate, name), original.replace(originalLock, originalLock.replace('for update;', 'for update nowait;')))
 }
})

test('incident recovery gate accepts only the recorded production migrations and held candidate', () => {
 const entries = Object.keys(incidentRecoveryMigrationScope.hashes).sort().map(path => ({ path, status: 'A', source: readFileSync(path, 'utf8') }))
 assert.equal(matchesIncidentRecoveryMigrationScope(incidentRecoveryMigrationScope.base, entries), true)
 assert.equal(matchesIncidentRecoveryMigrationScope('wrong-base', entries), false)
 assert.equal(matchesIncidentRecoveryMigrationScope(incidentRecoveryMigrationScope.base, entries.slice(1)), false)
 assert.equal(matchesIncidentRecoveryMigrationScope(incidentRecoveryMigrationScope.base, [...entries, entries[0]]), false)
 for (const change of [{ status: 'M' }, { path: 'supabase/migrations/20990101000000_unreviewed.sql' }, { source: entries[0].source + 'select 1;' }]) {
  assert.equal(matchesIncidentRecoveryMigrationScope(incidentRecoveryMigrationScope.base, [{ ...entries[0], ...change }, ...entries.slice(1)]), false)
 }
})

test('combined migration exception accepts only the exact added files and verified base', () => {
  const entries = Object.keys(hardeningMigrationScope.hashes).sort().map((path) => ({ path, status: 'A', source: readFileSync(path, 'utf8') }))
  assert.equal(matchesHardeningMigrationScope(hardeningMigrationScope.base, entries), true)
  assert.equal(matchesHardeningMigrationScope('wrong-base', entries), false)
  assert.equal(matchesHardeningMigrationScope(hardeningMigrationScope.base, [...entries, entries[0]]), false)
  assert.equal(matchesHardeningMigrationScope(hardeningMigrationScope.base, [{ ...entries[0], status: 'M' }, entries[1]]), false)
  assert.equal(matchesHardeningMigrationScope(hardeningMigrationScope.base, [{ ...entries[0], source: entries[0].source + 'select 1;' }, entries[1]]), false)
})

test('combined V1 migration gate rejects unreviewed base, altered SQL, replacements and extra files', () => {
 const entries=Object.keys(completeV1MigrationScope.hashes).sort().map(path=>({path,status:'A',source:readFileSync(path,'utf8')}))
 assert.equal(matchesCompleteV1MigrationScope(completeV1MigrationScope.base,entries),true)
 assert.equal(matchesCompleteV1MigrationScope('wrong-base',entries),false)
 assert.equal(matchesCompleteV1MigrationScope(completeV1MigrationScope.base,entries.slice(1)),false)
 assert.equal(matchesCompleteV1MigrationScope(completeV1MigrationScope.base,[...entries,entries[0]]),false)
 for(const change of [{status:'M'},{path:'supabase/migrations/20990101000000_unreviewed.sql'},{source:entries[0].source+'select 1;'}]) {
  assert.equal(matchesCompleteV1MigrationScope(completeV1MigrationScope.base,[{...entries[0],...change},...entries.slice(1)]),false)
 }
})

test('actual migration gate rejects valid-named untracked SQL before it can escape reviewed inventory', t => {
 const root=mkdtempSync(path.join(os.tmpdir(),'football-migration-gate-'))
 t.after(()=>{const resolved=path.resolve(root);assert.equal(path.dirname(resolved),path.resolve(os.tmpdir()));assert.ok(path.basename(resolved).startsWith('football-migration-gate-'));rmSync(resolved,{recursive:true,force:true})})
 mkdirSync(path.join(root,'scripts'));mkdirSync(path.join(root,'supabase','migrations'),{recursive:true})
 for(const name of ['security-migration-gate.mjs','v1-hardening-migration-scope.mjs'])copyFileSync('scripts/'+name,path.join(root,'scripts',name))
 const git=(...args)=>execFileSync('git',['-c','safe.directory='+root,...args],{cwd:root,encoding:'utf8',stdio:'pipe'})
 git('init');writeFileSync(path.join(root,'supabase','migrations','20260101000000_fixture.sql'),'select 1;\n');git('add','supabase/migrations')
 git('-c','user.name=Local QA','-c','user.email=qa@example.invalid','-c','commit.gpgsign=false','commit','-m','Synthetic migration gate fixture')
 git('update-ref','refs/remotes/origin/main',git('rev-parse','HEAD').trim())
 const run=()=>spawnSync(process.execPath,['scripts/security-migration-gate.mjs'],{cwd:root,encoding:'utf8',env:{...process.env,GIT_CONFIG_COUNT:'1',GIT_CONFIG_KEY_0:'safe.directory',GIT_CONFIG_VALUE_0:root}})
 assert.equal(run().status,0)
 writeFileSync(path.join(root,'supabase','migrations','20260102000000_unreviewed.sql'),'select 2;\n')
 const result=run();assert.notEqual(result.status,0);assert.match(result.stderr,/Untracked migration is outside the reviewed source inventory/)
 writeFileSync(path.join(root,'.git','info','exclude'),'supabase/migrations/20260102000000_unreviewed.sql\n')
 const ignored=run();assert.notEqual(ignored.status,0);assert.match(ignored.stderr,/Untracked migration is outside the reviewed source inventory/)
})
