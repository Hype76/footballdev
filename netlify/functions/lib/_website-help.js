import { websiteHelpArticles, websiteHelpFallback, websiteHelpPrivacyReply } from '../../../src/lib/website-help-library.js'

const privateTerms = /\b(jeluma|company|companies|director|directors|founder|founders|owner|owners|shareholder|shareholders|investor|investors|revenue|profit|valuation|registered|registration|vat|tax|steve|simon|personal|private|confidential|identity|identities|address|addresses|birthdays?|birth|dob|salary|salaries|bank|contact details|phone number|telephone|who owns|who runs|who built|who created|who developed|who works|who is|who are|full name|real name|names of|list users|list players|show users|show players)\b/i
const personalInput = /@|https?:\/\/|\b\d[\d\s()+.-]{5,}\d\b|\b(my name is|i am called|i'm called|i live|my email|my phone|my number|my password|verification code|api key|api_key|secret|token)\b/i
const instructionAttack = /\b(ignore|disregard|override|jailbreak|pretend|roleplay|role play|system prompt|developer message|instructions|execute|decode|base64|translate|repeat after|write code|write a poem)\b/i

export function prepareWebsiteHelp(message) {
  const normal = message.normalize('NFKC').toLowerCase().replace(/[\u200B-\u200D\uFEFF]/g, '')
  if (privateTerms.test(normal) || personalInput.test(normal)) return { reply: websiteHelpPrivacyReply }
  if (instructionAttack.test(normal)) return { reply: websiteHelpFallback }
  // Send only exact allowlisted product terms, never the raw question or conversation.
  const words = ` ${normal.replace(/[^a-z -]/g, ' ').replace(/\s+/g, ' ')} `
  const topics = websiteHelpArticles.map((article) => ({
    id: article.id,
    matches: article.keywords.filter((keyword) => words.includes(` ${keyword} `)),
  })).filter((topic) => topic.matches.length)
  if (!topics.length) return { reply: websiteHelpFallback }
  return { topics }
}

export async function selectWebsiteHelp(topics, { apiKey, fetchImpl = fetch } = {}) {
  const ids = topics.map((topic) => topic.id)
  const response = await fetchImpl('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(10000),
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      store: false,
      temperature: 0,
      max_completion_tokens: 80,
      messages: [
        { role: 'system', content: 'Select the most relevant Football Player product help topic from the recognised product terms. You must only choose an allowed ID or unavailable. Prefer specific feature topics over overview or general access when present. Output no prose. There is no access to company, personal or account data.' },
        { role: 'user', content: JSON.stringify(topics) },
      ],
      response_format: { type: 'json_schema', json_schema: { name: 'football_player_help', strict: true, schema: { type: 'object', properties: { articleId: { type: 'string', enum: [...ids, 'unavailable'] } }, required: ['articleId'], additionalProperties: false } } },
    }),
  })
  if (!response.ok) throw Object.assign(new Error('Help provider unavailable'), { providerStatus: response.status })
  const data = await response.json()
  const content = data.choices?.[0]?.message?.content
  if (data.choices?.[0]?.finish_reason !== 'stop' || typeof content !== 'string') return websiteHelpFallback
  let selected
  try { selected = JSON.parse(content) } catch { return websiteHelpFallback }
  if (Object.keys(selected || {}).length !== 1 || !ids.includes(selected.articleId)) return websiteHelpFallback
  // Never return model-generated text, URLs, extra fields or arbitrary IDs.
  const article = websiteHelpArticles.find((item) => item.id === selected.articleId)
  return { id: article.id, answer: article.answer, href: article.href, linkLabel: article.linkLabel }
}
