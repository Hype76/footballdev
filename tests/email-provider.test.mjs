import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  EmailProviderError,
  createFromAddress,
  getEmailProviderConfig,
  sendEmail,
} from '../netlify/functions/lib/_email-provider.js'

const validEnv = {
  RESEND_API_KEY: 're_test_key',
  RESEND_FROM_EMAIL: 'feedback@footballplayer.online',
}

test('email provider reports missing configuration without exposing secrets', () => {
  const config = getEmailProviderConfig({})

  assert.equal(config.configured, false)
  assert.deepEqual(config.missing, ['RESEND_API_KEY'])
  assert.equal(config.apiKey, '')
})

test('createFromAddress uses configured sender domain', () => {
  assert.equal(
    createFromAddress('Coach Name', validEnv),
    'Coach Name <feedback@footballplayer.online>',
  )
})

test('sendEmail succeeds and normalizes reply_to to replyTo', async () => {
  const calls = []
  const resendClient = {
    emails: {
      send: async (payload) => {
        calls.push(payload)
        return { data: { id: 'email_123' } }
      },
    },
  }

  const response = await sendEmail({
    from: 'Coach <feedback@footballplayer.online>',
    to: ['parent@example.com'],
    reply_to: 'coach@example.com',
    subject: 'Fixture update',
    html: '<p>Hello</p>',
  }, {
    env: validEnv,
    resendClient,
    context: { emailType: 'test_email' },
  })

  assert.equal(response.data.id, 'email_123')
  assert.equal(calls.length, 1)
  assert.equal(calls[0].replyTo, 'coach@example.com')
  assert.equal(Object.hasOwn(calls[0], 'reply_to'), false)
})

test('sendEmail throws when the provider returns an error object', async () => {
  const resendClient = {
    emails: {
      send: async () => ({
        error: {
          message: 'Domain is not verified',
          statusCode: 403,
          name: 'validation_error',
        },
      }),
    },
  }

  await assert.rejects(
    () => sendEmail({
      from: 'Coach <feedback@footballplayer.online>',
      to: ['parent@example.com'],
      subject: 'Fixture update',
      html: '<p>Hello</p>',
    }, {
      env: validEnv,
      resendClient,
      publicMessage: 'Email could not be sent. Please try again in a moment.',
    }),
    (error) => {
      assert.equal(error instanceof EmailProviderError, true)
      assert.equal(error.statusCode, 502)
      assert.equal(error.providerStatus, 403)
      assert.equal(error.publicMessage, 'Email could not be sent. Please try again in a moment.')
      return true
    },
  )
})
