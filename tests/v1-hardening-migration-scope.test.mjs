import assert from 'node:assert/strict'
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, copyFileSync, rmSync } from 'node:fs'
import { execFileSync, spawnSync } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { hardeningMigrationScope, matchesHardeningMigrationScope, completeV1MigrationScope, matchesCompleteV1MigrationScope } from '../scripts/v1-hardening-migration-scope.mjs'

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
})
