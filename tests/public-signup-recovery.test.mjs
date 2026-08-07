import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import {
  PUBLIC_FREE_SIGNUP_PATH,
  getPublicFreeSignupPlanKey as getClientPublicFreeSignupPlanKey,
} from '../src/lib/public-signup.js'
import {
  getPublicFreeSignupPlanKey as getServerPublicFreeSignupPlanKey,
  hasPublicFreeSignupIntent,
} from '../netlify/functions/lib/_signup-policy.js'

const testDirectory = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(testDirectory, '..')

async function readRepoFile(path) {
  return readFile(resolve(repoRoot, path), 'utf8')
}

test('public free signup opens the signup mode with the Individual plan', () => {
  assert.equal(PUBLIC_FREE_SIGNUP_PATH, '/sign-in?mode=signup&plan=individual')
  assert.equal(getClientPublicFreeSignupPlanKey('Individual Coach - Free'), 'individual')
  assert.equal(getClientPublicFreeSignupPlanKey('single_team'), '')
})

test('production policy authorises only explicit own-club free signup without checkout', () => {
  const authUser = {
    user_metadata: {
      club_name: 'FP TEST Signup Club',
      signup_plan_key: 'individual',
    },
  }

  assert.equal(getServerPublicFreeSignupPlanKey(authUser), 'individual')
  assert.equal(hasPublicFreeSignupIntent(authUser), true)
  assert.equal(hasPublicFreeSignupIntent(authUser, {
    clubName: 'FP TEST Signup Club',
    planKey: 'individual',
    signupIntent: true,
  }), true)
})

test('paid and internal plans remain fail closed without checkout or tester authority', () => {
  for (const planKey of ['single_team', 'small_club', 'development_club', 'large_club', 'pilot']) {
    const authUser = {
      user_metadata: {
        club_name: 'FP TEST Signup Club',
        signup_plan_key: planKey,
      },
    }

    assert.equal(getServerPublicFreeSignupPlanKey(authUser, planKey), '')
    assert.equal(hasPublicFreeSignupIntent(authUser, {
      clubName: 'FP TEST Signup Club',
      planKey,
      signupIntent: true,
    }), false)
  }
})

test('every public Start free route uses the canonical signup entry point', async () => {
  const publicSources = await Promise.all([
    'src/pages/PublicLandingPage.jsx',
    'src/pages/PublicFeaturesPage.jsx',
    'src/pages/PublicParentsPage.jsx',
    'src/pages/PublicPricingPage.jsx',
    'src/components/login/LoginHeroContent.jsx',
  ].map(readRepoFile))

  for (const source of publicSources) {
    assert.match(source, /PUBLIC_FREE_SIGNUP_PATH/)
  }

  const loginPage = await readRepoFile('src/pages/LoginPage.jsx')
  const auth = await readRepoFile('src/lib/auth.js')
  const signupFunction = await readRepoFile('netlify/functions/ensure-signup-club-profile.js')

  assert.match(loginPage, /getPublicFreeSignupPlanKey\(params\.get\('plan'\)\)/)
  assert.match(loginPage, /planKey: 'individual'/)
  assert.match(auth, /planKey = PLAN_KEYS\.individual/)
  assert.match(auth, /signup_plan_key: normalizedPlanKey === PLAN_KEYS\.individual/)
  assert.match(signupFunction, /hasPublicFreeSignupIntent\(authUser, body\)/)
})
