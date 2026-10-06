import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import test from 'node:test'

const source = readFileSync('public/marketing-v70/development-pdf.js', 'utf8').replace(/^export /gm, '')
const clean = vm.runInNewContext(source + '\nclean')

test('marketing PDF removes unsafe ASCII controls while preserving intended whitespace', () => {
  for (let code = 0; code < 128; code++) {
    const character = String.fromCharCode(code)
    const expected = code === 9 ? '    ' : code === 10 || code === 13 ? '\n'
      : code < 32 || code === 127 ? '' : character
    assert.equal(clean(character), expected, 'ASCII code ' + code)
  }
  assert.equal(clean('First\r\nSecond\rThird\tFourth'), 'First\nSecond\nThird    Fourth')
})

test('marketing PDF retains Unicode player names and symbols and normalises punctuation', () => {
  assert.equal(clean('Zoë Łukasz 李 ⚽'), 'Zoë Łukasz 李 ⚽')
  assert.equal(clean('\u{10348}\u{1D49C}'), '\u{10348}\u{1D49C}')
  assert.equal(clean('A\u2013B\u2014C'), 'A-B-C')
  assert.equal(clean(null), '')
  assert.equal(clean(12), '12')
})
