import assert from 'node:assert/strict'

export function assertQaUploadProfile(profile, appRole) {
  assert.equal(profile?.android?.track, 'internal', 'QA upload must stay on the internal Play track')
  assert.equal(profile.android.releaseStatus, 'completed', 'QA builds must be available to internal testers')
  assert.equal(profile.android.changesNotSentForReview, false, 'QA uploads must complete internal-track publication')
  assert.equal(profile?.ios?.ascAppId, { coach: '6772059305', parent: '6772061464' }[appRole], 'QA upload app identity mismatch')
}

export function assertQaUploadBuild(build, { appRole, projectId, head, version, platform }) {
  assert.equal(build.status, 'FINISHED', 'QA upload requires a completed native build')
  assert.equal(build.platform, platform.toUpperCase(), 'QA build platform mismatch')
  assert.equal(build.app?.id, projectId, 'QA build Expo project mismatch')
  assert.equal(build.appIdentifier, { coach: 'com.footballplayer.coach', parent: 'com.footballplayer.parents' }[appRole], 'QA build app identity mismatch')
  assert.equal(build.distribution, 'STORE', 'QA upload requires the store artifact')
  assert.equal(build.buildProfile, 'store-live', 'QA upload requires the approved production environment build')
  assert.equal(build.updateChannel?.name, 'production', 'QA build channel mismatch')
  assert.equal(build.gitCommitHash, head, 'QA build does not match the reviewed source')
  assert.equal(build.appVersion, version, 'QA build version mismatch')
  assert.equal(build.runtime?.version, version, 'QA build runtime mismatch')
  assert.notEqual(build.isForIosSimulator, true, 'A simulator build cannot qualify physical-device QA')
}
