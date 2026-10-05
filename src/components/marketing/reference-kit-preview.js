/* eslint-disable */
/* Ported trusted v70 reference; DOM and lifecycle access are scoped by React. */
export default function mountReference(scope) {
const { document, window, fetch, addEventListener, matchMedia, IntersectionObserver, setTimeout, clearTimeout, setInterval, clearInterval } = scope;
(() => {
  const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)');
  document.querySelectorAll('.kit-hotspot').forEach(button => {
    const panel = document.getElementById(button.getAttribute('aria-controls'));
    if (!panel) return;
    let timer;
    const cancel = () => clearTimeout(timer);
    const show = () => { cancel(); panel.hidden = false; button.setAttribute('aria-expanded', 'true'); };
    const hide = () => { cancel(); panel.hidden = true; button.setAttribute('aria-expanded', 'false'); };
    const closeSoon = () => { cancel(); timer = setTimeout(hide, 450); };
    button.addEventListener('mouseenter', () => { if (finePointer.matches) show(); });
    button.addEventListener('mouseleave', () => { if (finePointer.matches) closeSoon(); });
    button.addEventListener('click', () => { if (panel.hidden) show(); else if (!finePointer.matches) hide(); else cancel(); });
    panel.addEventListener('mouseenter', cancel);
    panel.addEventListener('mouseleave', () => { if (finePointer.matches) closeSoon(); });
    panel.querySelector('[data-kit-close]').addEventListener('click', () => { hide(); button.focus(); });
    document.addEventListener('keydown', event => { if (event.key === 'Escape' && !panel.hidden) { hide(); button.focus(); } });
    document.addEventListener('click', event => { if (!panel.contains(event.target) && !button.contains(event.target)) hide(); });
  });
})();

}
