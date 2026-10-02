// Conservative 25-second request deadline, including setup, below Netlify's
// documented 30-second scheduled and 60-second synchronous limits. No schedule
// is installed. Abort reaches HTTP reads/writes, Resend and Expo; an uncertain
// claimed send remains held by the durable lease/reconciliation contract.
export function createCoachReminderDeadline({timeoutMs=25000,fetchImpl=globalThis.fetch,now=()=>performance.now()}={}) {
  const controller=new AbortController(),end=now()+timeoutMs
  const timer=setTimeout(()=>controller.abort(new DOMException('Reminder hard deadline reached.','AbortError')),timeoutMs)
  const remainingMs=()=>Math.max(0,end-now())
  const fetch=async(input,init={})=>{
    controller.signal.throwIfAborted()
    const signals=[controller.signal,init.signal,input instanceof Request ? input.signal : null].filter(Boolean)
    return fetchImpl(input,{...init,signal:AbortSignal.any(signals)})
  }
  // Attach to the builder as well as fetch so the SDK's retry/backoff sleeps
  // are cancellable. A fetch-only signal cannot interrupt Retry-After delays.
  const wrap=query=>new Proxy(query,{get(target,key){
    if(key==='then')return (resolve,reject)=>target.abortSignal(controller.signal).then(resolve,reject)
    const value=target[key]
    return typeof value==='function' ? (...args)=>{
      const next=value.apply(target,args)
      return next && typeof next==='object' && (typeof next.select==='function' || typeof next.then==='function') ? wrap(next) : next
    } : value
  }})
  const client=database=>({from:(...args)=>wrap(database.from(...args)),rpc:(...args)=>wrap(database.rpc(...args))})
  return {signal:controller.signal,remainingMs,fetch,client,close:()=>clearTimeout(timer)}
}
