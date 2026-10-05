/* eslint-disable */
/* Ported trusted v70 reference; DOM and lifecycle access are scoped by React. */
export default function mountReference(scope) {
const { document, window, fetch, addEventListener, matchMedia, IntersectionObserver, setTimeout, clearTimeout, setInterval, clearInterval } = scope;
(()=>{const items=[...document.querySelectorAll('.tutorial-item')];items.forEach(item=>{item.addEventListener('toggle',()=>{if(item.open){items.forEach(other=>{if(other!==item){other.open=false;other.querySelectorAll('video').forEach(v=>v.pause())}})}else{item.querySelectorAll('video').forEach(v=>v.pause())}})})})();

}
