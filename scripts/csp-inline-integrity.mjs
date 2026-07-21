import { createHash } from 'node:crypto'

const INLINE_SCRIPT_PATTERN = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi

export function normalizeBrowserScriptText(value) {
  return String(value).replace(/\r\n/g, '\n').replace(/\r/g, '\n')
}

export function createBrowserCspHash(value) {
  const normalizedText = normalizeBrowserScriptText(value)
  const digest = createHash('sha256')
    .update(Buffer.from(normalizedText, 'utf8'))
    .digest('base64')

  return `sha256-${digest}`
}

export function extractInlineScriptTexts(html) {
  return [...String(html).matchAll(INLINE_SCRIPT_PATTERN)].map((match) => match[1])
}

export function extractCspScriptSource(netlifyConfig) {
  const csp = String(netlifyConfig).match(/Content-Security-Policy = "([^"]+)"/)?.[1] || ''
  return csp.match(/(?:^|;\s*)script-src\s+([^;]+)/)?.[1] || ''
}

export function extractConfiguredScriptHashes(netlifyConfig) {
  const scriptSource = extractCspScriptSource(netlifyConfig)
  return [...scriptSource.matchAll(/'(sha256-[^']+)'/g)]
    .map((match) => match[1])
    .sort()
}

export function assertBrowserCompatibleInlineCsp({ expectedScriptCount = 2, html, netlifyConfig }) {
  const inlineScripts = extractInlineScriptTexts(html)
  if (inlineScripts.length !== expectedScriptCount) {
    throw new Error(`Expected ${expectedScriptCount} inline scripts, found ${inlineScripts.length}`)
  }

  const browserHashes = inlineScripts.map(createBrowserCspHash).sort()
  const configuredHashes = extractConfiguredScriptHashes(netlifyConfig)
  const missingHashes = browserHashes.filter((hash) => !configuredHashes.includes(hash))
  const orphanHashes = configuredHashes.filter((hash) => !browserHashes.includes(hash))

  if (missingHashes.length > 0) {
    throw new Error(`CSP is missing ${missingHashes.length} browser-normalized inline script hash(es)`)
  }
  if (orphanHashes.length > 0) {
    throw new Error(`CSP contains ${orphanHashes.length} orphan inline script hash(es)`)
  }

  const scriptSource = extractCspScriptSource(netlifyConfig)
  if (/unsafe-inline|unsafe-eval|(?:^|\s)\*(?:\s|$)/.test(scriptSource)) {
    throw new Error('CSP script-src contains a permissive source')
  }

  return {
    browserHashes,
    configuredHashes,
    inlineScripts,
    normalizedScripts: inlineScripts.map(normalizeBrowserScriptText),
    scriptSource,
  }
}
