import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import helpLogo from '../../assets/football-player-logo.png'
import { websiteHelpArticles, websiteHelpFallback, websiteHelpPrivacyReply } from '../../lib/website-help-library.js'

const starters = ['What is Football Player?', 'What can parents see?', 'Where can I see pricing?']
const welcome = 'Ask about Football Player features, signing in, or using the website. Please do not include personal details. Replies come from our product help library.'

export function WebsiteHelpChat() {
  const [isOpen, setIsOpen] = useState(false)
  const [question, setQuestion] = useState('')
  const [replies, setReplies] = useState([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const inputRef = useRef(null)
  const triggerRef = useRef(null)
  const endRef = useRef(null)
  const controllerRef = useRef(null)
  const submittingRef = useRef(false)

  useEffect(() => {
    if (!isOpen) return
    inputRef.current?.focus()
    const escape = event => {
      if (event.key === 'Escape') { setIsOpen(false); triggerRef.current?.focus() }
    }
    window.addEventListener('keydown', escape)
    return () => window.removeEventListener('keydown', escape)
  }, [isOpen])
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'nearest' })
  }, [replies, busy])
  useEffect(() => () => controllerRef.current?.abort(), [])

  function close() {
    setIsOpen(false)
    triggerRef.current?.focus()
  }

  async function ask(message) {
    if (submittingRef.current || !message.trim()) return
    submittingRef.current = true
    setBusy(true)
    setError('')
    setQuestion('')
    const controller = new AbortController()
    controllerRef.current = controller
    const timer = setTimeout(() => controller.abort(), 15000)
    try {
      const response = await fetch('/api/website-help', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'omit',
        signal: controller.signal,
        body: JSON.stringify({ message }),
      })
      if (!response.ok) {
        setError(response.status === 429 ? 'Please wait a minute before asking another question.' : 'Help is unavailable. Please try again or use Contact us.')
        return
      }
      const result = await response.json()
      // Render local approved copy only, even if an endpoint returns unexpected prose.
      const approved = [...websiteHelpArticles, websiteHelpFallback, websiteHelpPrivacyReply].find((item) => item.id === result.id) || websiteHelpFallback
      setReplies((current) => [...current.slice(-9), approved])
      if (result.unavailable) setError('AI help is temporarily unavailable. You can still use the links below.')
    } catch {
      setError('Help is unavailable. Please try again or use Contact us.')
    } finally {
      clearTimeout(timer)
      controllerRef.current = null
      submittingRef.current = false
      setBusy(false)
    }
  }

  function contact() {
    close()
    window.dispatchEvent(new CustomEvent('football-player:open-contact'))
  }

  return createPortal(
    <>
      <button ref={triggerRef} type="button" aria-label={isOpen ? 'Close Football Player help' : 'Open Football Player help'} aria-expanded={isOpen} aria-controls="website-help-chat" onClick={() => isOpen ? close() : setIsOpen(true)} className="fixed bottom-5 right-4 z-50 inline-flex min-h-12 items-center gap-3 rounded-full focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#c6ff1a] sm:right-6">
        {!isOpen ? <span className="relative rounded-full bg-[#ffffff] px-4 py-2 text-sm font-semibold text-[#06110a] shadow-md after:absolute after:-right-1 after:top-1/2 after:h-2 after:w-2 after:-translate-y-1/2 after:rotate-45 after:bg-[#ffffff]">Here to help</span> : null}
        <img src={helpLogo} alt="" className="h-12 w-12 rounded-full object-contain shadow-md" />
      </button>
      {isOpen ? (
        <aside id="website-help-chat" role="dialog" aria-modal="false" aria-labelledby="website-help-title" onKeyDown={(event) => { if (event.key === 'Escape') close() }} className="fixed bottom-20 right-3 z-[70] flex max-h-[min(640px,calc(100dvh-110px))] w-[calc(100%-24px)] flex-col overflow-hidden rounded-lg border border-white/15 bg-[#06110a] text-white shadow-2xl sm:right-6 sm:w-96">
          <div className="flex items-center justify-between border-b border-white/15 px-4 py-3">
            <div>
              <h2 id="website-help-title" className="font-bold">Football Player help</h2>
              <p className="text-xs text-white/70">Product questions only</p>
            </div>
            <button type="button" aria-label="Close help" onClick={close} className="min-h-11 min-w-11 text-xl">×</button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
            <p className="text-sm leading-6 text-white/85">{welcome}</p>
            {!replies.length ? <div className="mt-3 flex flex-col divide-y divide-white/10">{starters.map((starter) => <button key={starter} type="button" disabled={busy} onClick={() => ask(starter)} className="min-h-11 py-2 text-left text-sm font-semibold text-[#c6ff1a] disabled:opacity-50">{starter}</button>)}</div> : null}
            <div role="log" aria-live="polite" aria-relevant="additions" className="divide-y divide-white/10">
              {replies.map((item, index) => <div key={`${index}-${item.id}`} className="py-4">
                <p className="text-sm leading-6">{item.answer}</p>
                {item.href ? <a href={item.href} className="mt-1 inline-flex min-h-11 items-center text-sm font-bold text-[#c6ff1a] underline underline-offset-4">{item.linkLabel}</a> : <button type="button" onClick={contact} className="mt-1 min-h-11 text-sm font-bold text-[#c6ff1a] underline underline-offset-4">{item.linkLabel}</button>}
              </div>)}
            </div>
            {busy ? <p role="status" className="py-3 text-sm text-white/70">Finding product help...</p> : null}
            <div ref={endRef} />
          </div>
          <form className="shrink-0 border-t border-white/15 p-4" onSubmit={(event) => { event.preventDefault(); void ask(question) }}>
            <label htmlFor="website-help-question" className="text-sm font-semibold">Your product question</label>
            <textarea ref={inputRef} id="website-help-question" value={question} onChange={(event) => setQuestion(event.target.value)} maxLength={600} rows={2} disabled={busy} className="mt-2 w-full resize-none rounded border border-white/30 bg-white/5 p-3 text-sm text-white focus:outline-2 focus:outline-[#c6ff1a] disabled:opacity-50" />
            {error ? <p role="alert" className="mt-2 text-sm text-[#facc15]">{error}</p> : null}
            <div className="mt-2 flex items-center justify-between gap-3">
              <button type="button" onClick={contact} className="min-h-11 text-sm text-white/80 underline underline-offset-4">Contact us</button>
              <button type="submit" disabled={busy || !question.trim()} className="min-h-11 rounded bg-[#c6ff1a] px-5 text-sm font-bold text-[#06110a] disabled:opacity-40">Ask</button>
            </div>
          </form>
        </aside>
      ) : null}
    </>, document.body,
  )
}
