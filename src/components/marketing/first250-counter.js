export function mountFirst250Counter({ document, fetch, setTimeout, clearTimeout }) {
  const counter = document.querySelector('#first-250 .promotion-counter')
  if (!counter) return () => {}
  const total = counter.querySelector('.promotion-total strong')
  const denominator = counter.querySelector('.promotion-total span')
  const summary = counter.querySelector('.promotion-summary')
  const grid = counter.querySelector('.promotion-footballs')
  const slots = counter.querySelectorAll('.promotion-football-grid .promotion-slot')
  const key = counter.querySelector('.promotion-football-key')
  const reservedLabel = counter.querySelector('[data-offer-reserved-label]')
  const remainingLabel = counter.querySelector('[data-offer-remaining-label]')
  const controller = new AbortController()
  let active = true
  const unavailable = () => {
    total.textContent = 'Unavailable'
    total.style.fontSize = '1.5rem'
    denominator.hidden = true
    summary.textContent = 'Offer availability is temporarily unavailable. Please try again later.'
    grid.hidden = true
    key.style.display = 'none'
  }
  const timer = setTimeout(() => controller.abort(), 10000)
  counter.setAttribute('aria-live', 'polite')
  ;(async () => {
    try {
      const response = await fetch('/.netlify/functions/manage-team-branding', { method: 'GET', cache: 'no-store', signal: controller.signal })
      if (!response.ok) throw new Error('Offer unavailable')
      const data = await response.json()
      if (!active) return
      if (data?.status === 'not_active') {
        total.textContent = 'Offer not active'
        total.style.fontSize = '1.5rem'
        denominator.hidden = true
        summary.textContent = 'This offer is not currently active. Check availability when you create your account.'
        grid.hidden = true
        key.style.display = 'none'
        return
      }
      if (data?.status !== 'active' || data.capacity !== 250 || !Number.isInteger(data.reserved) || data.reserved < 39 || data.reserved > 250 || data.remaining !== 250 - data.reserved) throw new Error('Invalid offer availability')
      total.textContent = String(data.reserved)
      total.style.fontSize = ''
      denominator.hidden = false
      summary.textContent = data.remaining ? `${data.reserved} teams reserved · ${data.remaining} places remaining` : 'All 250 places have been reserved.'
      slots.forEach((slot, index) => slot.classList.toggle('is-filled', index < data.reserved))
      grid.setAttribute('aria-label', `250 team places: ${data.reserved} reserved and ${data.remaining} available`)
      grid.hidden = false
      reservedLabel.textContent = `${data.reserved} teams reserved`
      remainingLabel.textContent = `${data.remaining} places available`
      key.style.display = ''
    } catch {
      if (active) unavailable()
    } finally {
      clearTimeout(timer)
    }
  })()
  return () => { active = false; clearTimeout(timer); controller.abort() }
}
