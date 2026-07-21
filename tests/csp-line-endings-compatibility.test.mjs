import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import {
  assertBrowserCompatibleInlineCsp,
  createBrowserCspHash,
  extractConfiguredScriptHashes,
  extractInlineScriptTexts,
  normalizeBrowserScriptText,
} from '../scripts/csp-inline-integrity.mjs'

test('browser line-ending normalization is deterministic for LF, CRLF, and lone CR text', () => {
  const lf = "\nconst label = 'Café football'\n\n"
  const crlf = lf.replace(/\n/g, '\r\n')
  const loneCr = lf.replace(/\n/g, '\r')

  assert.equal(normalizeBrowserScriptText(crlf), lf)
  assert.equal(normalizeBrowserScriptText(loneCr), lf)
  assert.equal(createBrowserCspHash(lf), createBrowserCspHash(crlf))
  assert.equal(createBrowserCspHash(lf), createBrowserCspHash(loneCr))
  assert.equal(
    createBrowserCspHash(lf),
    `sha256-${createHash('sha256').update(Buffer.from(lf, 'utf8')).digest('base64')}`,
  )
})

test('normalization preserves leading, trailing, blank-line, and Unicode content', () => {
  const source = "\r\n\r\n  const message = 'мяч ⚽'  \t\r\n\r"
  const normalized = "\n\n  const message = 'мяч ⚽'  \t\n\n"

  assert.equal(normalizeBrowserScriptText(source), normalized)
  assert.ok(normalizeBrowserScriptText(source).startsWith('\n\n  '))
  assert.ok(normalizeBrowserScriptText(source).endsWith('\n\n'))
})

test('the previous CRLF raw-hash model fails while browser-normalized hashes pass', () => {
  const lfHtml = '<script>\n  window.first = true\n</script>\n<script type="application/ld+json">\n  {"safe":true}\n</script>\n'
  const crlfHtml = lfHtml.replace(/\n/g, '\r\n')
  const scripts = extractInlineScriptTexts(crlfHtml)
  const rawHashes = scripts.map((script) => `sha256-${createHash('sha256').update(Buffer.from(script, 'utf8')).digest('base64')}`)
  const normalizedHashes = scripts.map(createBrowserCspHash)
  const config = (hashes) => `Content-Security-Policy = "default-src 'self'; script-src 'self' ${hashes.map((hash) => `'${hash}'`).join(' ')}"`

  assert.throws(
    () => assertBrowserCompatibleInlineCsp({ html: crlfHtml, netlifyConfig: config(rawHashes) }),
    /missing 2 browser-normalized inline script hash/,
  )
  assert.doesNotThrow(
    () => assertBrowserCompatibleInlineCsp({ html: crlfHtml, netlifyConfig: config(normalizedHashes) }),
  )
})

test('candidate HTML and CSP contain exactly two browser-compatible inline scripts', async () => {
  const [attributes, html, netlifyConfig] = await Promise.all([
    readFile(new URL('../.gitattributes', import.meta.url), 'utf8'),
    readFile(new URL('../index.html', import.meta.url), 'utf8'),
    readFile(new URL('../netlify.toml', import.meta.url), 'utf8'),
  ])

  assert.equal(attributes, '/.gitattributes text eol=lf\n/index.html text eol=lf\n')
  assert.doesNotMatch(html, /\r/)
  assert.equal(extractInlineScriptTexts(html).length, 2)
  const result = assertBrowserCompatibleInlineCsp({ html, netlifyConfig })
  assert.equal(result.browserHashes.length, 2)
  assert.deepEqual(result.browserHashes, result.configuredHashes)
  assert.doesNotMatch(result.scriptSource, /unsafe-inline|unsafe-eval|(?:^|\s)\*(?:\s|$)/)
  assert.match(netlifyConfig, /\[build\.processing\.html\][\s\S]*?pretty_urls\s*=\s*false/)
  assert.match(
    netlifyConfig,
    /\[context\.deploy-preview\][\s\S]*?command\s*=\s*"npm run build:live && npm run verify:build-env"/,
  )
  assert.match(
    netlifyConfig,
    /\[context\.branch-deploy\][\s\S]*?command\s*=\s*"node scripts\/staging-retired\.mjs branch-deploy"/,
  )
})

test('unexpected, missing, orphan, and modified inline script variants fail closed', async () => {
  const [html, netlifyConfig] = await Promise.all([
    readFile(new URL('../index.html', import.meta.url), 'utf8'),
    readFile(new URL('../netlify.toml', import.meta.url), 'utf8'),
  ])
  const scripts = extractInlineScriptTexts(html)
  const configuredHashes = extractConfiguredScriptHashes(netlifyConfig)

  assert.throws(
    () => assertBrowserCompatibleInlineCsp({ html: `${html}<script>void 0</script>`, netlifyConfig }),
    /Expected 2 inline scripts, found 3/,
  )

  const missingHashConfig = netlifyConfig.replace(` '${configuredHashes[0]}'`, '')
  assert.throws(
    () => assertBrowserCompatibleInlineCsp({ html, netlifyConfig: missingHashConfig }),
    /missing 1 browser-normalized inline script hash/,
  )

  const orphanHashConfig = netlifyConfig.replace(
    "script-src 'self'",
    "script-src 'self' 'sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='",
  )
  assert.throws(
    () => assertBrowserCompatibleInlineCsp({ html, netlifyConfig: orphanHashConfig }),
    /contains 1 orphan inline script hash/,
  )

  const modifiedHtml = html.replace(scripts[0], `${scripts[0]}\nvoid 0`)
  assert.throws(
    () => assertBrowserCompatibleInlineCsp({ html: modifiedHtml, netlifyConfig }),
    /missing 1 browser-normalized inline script hash/,
  )
})
