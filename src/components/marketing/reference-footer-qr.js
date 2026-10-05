/* eslint-disable */
/* Ported trusted v70 reference; DOM and lifecycle access are scoped by React. */
export default function mountReference(scope) {
const { document, window, fetch, addEventListener, matchMedia, IntersectionObserver, setTimeout, clearTimeout, setInterval, clearInterval } = scope;
(()=>{
  const stores=[...document.querySelectorAll('[data-store-qr]')];
  for(const store of stores){
    const reset=()=>store.classList.remove('qr-dismissed');
    store.addEventListener('pointerenter',reset);
    store.addEventListener('pointerleave',reset);
    store.addEventListener('focusin',reset);
    store.addEventListener('focusout',reset);
  }
  document.addEventListener('keydown',event=>{
    if(event.key==='Escape') stores.forEach(store=>store.classList.add('qr-dismissed'));
  });
})();

}
