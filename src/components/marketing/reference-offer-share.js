/* eslint-disable */
/* Ported trusted v70 reference; DOM and lifecycle access are scoped by React. */
export default function mountReference(scope) {
const { document, window, fetch, addEventListener, matchMedia, IntersectionObserver, setTimeout, clearTimeout, setInterval, clearInterval } = scope;
(() => {
  const dialog = document.getElementById('offer-share-dialog');
  const trigger = document.querySelector('[data-offer-share-open]');
  if (!dialog || !trigger || typeof dialog.showModal !== 'function') return;

  const note = document.getElementById('offer-share-note');
  const status = document.getElementById('offer-share-status');
  const input = document.getElementById('offer-share-url');
  const linkField = dialog.querySelector('[data-offer-share-link]');
  const buttons = Array.from(dialog.querySelectorAll('[data-offer-share]'));
  const config = window.FP_OFFER_SHARE;
  // Allow only the established public Football Player domain. A new launch
  // domain requires an explicit, reviewed code change, never an automatic fallback.
  function verifiedUrl() {
    if (!config || config.publicOfferLive !== true || typeof config.publicOfferUrl !== 'string') return '';
    try {
      const url = new URL(config.publicOfferUrl);
      if (url.protocol !== 'https:' || url.hostname !== 'footballplayer.online' ||
          url.port || url.username || url.password || url.search) return '';
      return url.href;
    } catch { return ''; }
  }
  const offerUrl = verifiedUrl();
  let busy = false;
  let resetTimer;
  let view = 0;
  const message = `Football Player: free team branding for the first 250 teams. See the offer and qualifying conditions: ${offerUrl}`;
  const setBusy = value => {
    busy = value;
    buttons.forEach(button => { button.disabled = !offerUrl || value; });
  };

  if (offerUrl) {
    note.textContent = 'Choose an app, then pick who to send it to. You can review or cancel before sending.';
    input.value = offerUrl;
    linkField.hidden = false;
  }
  setBusy(false);
  trigger.disabled = false;
  trigger.addEventListener('click', () => {
    if (dialog.open) return;
    view += 1;
    status.textContent = '';
    dialog.showModal();
  });
  dialog.querySelector('[data-offer-share-close]').addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', event => {
    if (event.target !== dialog) return;
    const box = dialog.getBoundingClientRect();
    if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) dialog.close();
  });
  dialog.addEventListener('close', () => {
    view += 1;
    // Do not reopen a chooser, retry a handoff or claim a sent message on cancel.
    status.textContent = '';
    trigger.focus();
  });
  input.addEventListener('click', () => input.select());

  buttons.forEach(button => button.addEventListener('click', async () => {
    // Native disabled state plus this guard prevents double activation and any
    // outgoing action in draft mode, including synthetic/programmatic clicks.
    if (!offerUrl || busy || !dialog.open) return;
    const activeView = view;
    const channel = button.dataset.offerShare;
    setBusy(true);
    status.textContent = '';
    if (channel === 'copy') {
      try {
        if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
        await navigator.clipboard.writeText(offerUrl);
        if (dialog.open && view === activeView) status.textContent = 'Public offer link copied.';
      } catch {
        if (dialog.open && view === activeView) {
          status.textContent = 'Couldn’t copy automatically. Select and copy the public offer link below the sharing options.';
          input.focus();
          input.select();
        }
      } finally { setBusy(false); }
      return;
    }
    try {
      if (channel === 'whatsapp') {
        // With noopener browsers may return null even when a tab opens. Never
        // treat that value, popup closure or returning to this page as sent.
        window.open(`https://wa.me/?text=${encodeURIComponent(message)}`, '_blank', 'noopener,noreferrer');
        status.textContent = 'Review in WhatsApp before sending. If it didn’t open, use Copy link instead.';
      } else if (channel === 'sms') {
        const isiOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
        window.location.assign(`sms:${isiOS ? '&' : '?'}body=${encodeURIComponent(message)}`);
        status.textContent = 'Review in your text app before sending. If it didn’t open or include the offer, use Copy link and paste it into a message.';
      } else if (channel === 'email') {
        window.location.assign(`mailto:?subject=${encodeURIComponent('Football Player: free team branding')}&body=${encodeURIComponent(message)}`);
        status.textContent = 'Review in your email app before sending. If it didn’t open, use Copy link instead.';
      }
    } catch {
      status.textContent = 'Couldn’t open that app. Use Copy link to share the offer yourself.';
    } finally {
      // A short duplicate-click guard; no automatic retries or navigation.
      clearTimeout(resetTimer);
      resetTimer = setTimeout(() => setBusy(false), 1000);
    }
  }));
})();

}
