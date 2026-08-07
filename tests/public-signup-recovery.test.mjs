import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import {
  PUBLIC_FREE_SIGNUP_PATH,
  PUBLIC_SIGNUP_ACCEPTED_MESSAGE,
  getPublicFreeSignupPlanKey as getClientPublicFreeSignupPlanKey,
  hasPublicFreeSignupMetadata,
} from '../src/lib/public-signup.js'
import {
  getPublicFreeSignupPlanKey as getServerPublicFreeSignupPlanKey,
  hasPublicFreeSignupIntent,
} from '../netlify/functions/lib/_signup-policy.js'

process.env.VITE_SUPABASE_URL ||= 'https://example.supabase.co'
process.env.VITE_SUPABASE_PUBLISHABLE_KEY ||= 'test-publishable-key'
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key'

const { getSignupRole } = await import('../netlify/functions/ensure-signup-club-profile.js')

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

test('public signup response stays truthful without revealing whether an account exists', async () => {
  assert.equal(
    PUBLIC_SIGNUP_ACCEPTED_MESSAGE,
    'If this is a new account, check your email for a verification link. If you already have an account, sign in or use Forgot password.',
  )

  const loginPage = await readRepoFile('src/pages/LoginPage.jsx')
  assert.match(loginPage, /PUBLIC_SIGNUP_ACCEPTED_MESSAGE/)
  assert.doesNotMatch(loginPage, /Account created\. Please check your email to verify your account before logging in\./)
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
  assert.equal(hasPublicFreeSignupMetadata(authUser), true)
})

test('first confirmed Club login completes only an explicit public free signup', async () => {
  assert.equal(hasPublicFreeSignupMetadata({
    user_metadata: {
      club_name: 'FP TEST Signup Club',
      signup_plan_key: 'individual',
    },
  }), true)
  assert.equal(hasPublicFreeSignupMetadata({
    user_metadata: {
      club_name: 'FP TEST Signup Club',
      signup_plan_key: 'small_club',
    },
  }), false)
  assert.equal(hasPublicFreeSignupMetadata({
    user_metadata: {
      signup_plan_key: 'individual',
    },
  }), false)

  const profileSource = await readRepoFile('src/lib/domain/core.js')
  assert.match(profileSource, /normalizedLoginAccessIntent === 'team'[\s\S]*hasPublicFreeSignupMetadata\(authUser\)/)
  assert.match(profileSource, /shouldCompleteSignupClubProfile\(\{[\s\S]*authUser,[\s\S]*loginAccessIntent/)
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

test('signup provisioning derives owner role from the selected commercial scope', () => {
  assert.deepEqual(getSignupRole('individual'), {
    role: 'head_manager',
    roleLabel: 'Coach Owner',
    roleRank: 70,
  })
  assert.deepEqual(getSignupRole('single_team'), {
    role: 'head_manager',
    roleLabel: 'Team Admin',
    roleRank: 70,
  })
  assert.deepEqual(getSignupRole('small_club'), {
    role: 'admin',
    roleLabel: 'Club Admin',
    roleRank: 90,
  })
  assert.throws(() => getSignupRole('unknown_future_plan'), /not supported/)
})
