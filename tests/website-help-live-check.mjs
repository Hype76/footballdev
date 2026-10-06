import process from 'node:process'
import assert from 'node:assert/strict'
import { prepareWebsiteHelp, selectWebsiteHelp } from '../netlify/functions/lib/_website-help.js'

if (!process.env.OPENAI_API_KEY) {
  console.error('Live help check requires the existing server key.')
  process.exit(1)
}

const cases = [
  ['What is Football Player?', 'overview'],
  ['What can parents see?', 'parents'],
  ['Where can I see pricing?', 'pricing'],
  ['How do I log in?', 'login'],
  ['How do development records work?', 'development'],
  ['What does Match Day do?', 'matchday'],
]
let passed = 0
for (const [question, expected] of cases) {
  try {
    const { topics } = prepareWebsiteHelp(question)
    const result = await selectWebsiteHelp(topics, { apiKey: process.env.OPENAI_API_KEY })
    assert.equal(result.id, expected)
    passed += 1
    console.log(`PASS: ${expected}`)
  } catch {
    console.error(`FAIL: ${expected}. Provider access or topic selection needs checking.`)
    process.exitCode = 1
  }
}
console.log(`Live approved-answer selection: ${passed}/${cases.length} passed.`)
