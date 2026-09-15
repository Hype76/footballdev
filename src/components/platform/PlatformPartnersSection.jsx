import { useEffect, useRef, useState } from 'react'
import { managePartners, partnerStats, uploadPartnerImage } from '../../lib/partner-api.js'
import { csvCell, findPartnerSpace, partnerRect, validatePartnerLayout, visiblePartnerItems } from '../../lib/partners.js'
import './partners.css'

const defaultApi = { managePartners, partnerStats, uploadPartnerImage }

function localInput(value) {
  if (!value) return ''
  const date = new Date(value)
  return new Date(date.getTime() - date.getTimezoneOffset()*60000).toISOString().slice(0,16)
}
function displayTime(value) {
  return new Intl.DateTimeFormat('en-GB',{ dateStyle:'short',timeStyle:'short',timeZone:'Europe/London' }).format(new Date(value)).replaceAll('/',':')
}
function gridStyle(item) { return { gridColumn:`${item.x+1} / span ${item.w}`,gridRow:`${item.y+1} / span ${item.h}` } }

export function PartnerPreview({ items }) {
  const visible = visiblePartnerItems(items)
  return <div className="partner-phone"><h3>Partners &amp; Special Offers</h3>{visible.length ? <div className="partner-preview-grid" style={{ gridTemplateRows:`repeat(${Math.max(...visible.map((i)=>i.y+i.h))}, 72px)` }}>{visible.map((item)=><div key={item.id} style={gridStyle(item)} className="partner-preview-tile"><img src={item.imageUrl} alt={item.alt} />{item.sponsored && <span className="partner-sponsored">Sponsored</span>}</div>)}</div> : <p>Our partners and their offers will appear here. Check back soon.</p>}<p className="partner-help">Preview only. Views and clicks are not counted.</p></div>
}

function PartnerAnalytics({ app, api }) {
  const [days,setDays]=useState(30)
  const [start,setStart]=useState('')
  const [end,setEnd]=useState('')
  const [accounts,setAccounts]=useState(false)
  const [offset,setOffset]=useState(0)
  const [report,setReport]=useState(null)
  const [error,setError]=useState('')
  const [loading,setLoading]=useState(false)
  const [refresh,setRefresh]=useState(0)
  useEffect(()=>{
    let cancelled=false
    async function load() {
      setLoading(true); setError('')
      try {
        const finish=end ? new Date(`${end}T23:59:59.999`).toISOString() : new Date().toISOString()
        const begin=start ? new Date(`${start}T00:00:00`).toISOString() : new Date(Date.now()-Number(days)*86400000).toISOString()
        const result=await api.partnerStats(app,begin,finish,accounts,offset)
        if (!cancelled) setReport(result)
      } catch (err) { if (!cancelled) {setError(err.message);setReport(null)} }
      finally { if (!cancelled) setLoading(false) }
    }
    void load(); return ()=>{cancelled=true}
  },[app,api,days,start,end,accounts,offset,refresh])
  function download() {
    const rows=[['Partner','Views','Clicks','Unique consenting accounts','Click-through rate'],...(report?.offers || []).map((o)=>[o.title,o.views,o.clicks,o.accounts,o.views ? `${(o.clicks/o.views*100).toFixed(1)}%`:'0%'])]
    const url=URL.createObjectURL(new Blob([rows.map((r)=>r.map(csvCell).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8'}))
    const link=document.createElement('a');link.href=url;link.download=`${app}-partner-report.csv`;link.click();URL.revokeObjectURL(url)
  }
  const summary=report?.summary || {}
  return <section className="partner-panel"><h2>Partner performance</h2><div className="partner-toolbar">
    <label>Period<select value={days} onChange={(e)=>{setDays(Number(e.target.value));setStart('');setEnd('');setOffset(0)}}><option value={1}>Last 24 hours</option><option value={7}>Last 7 days</option><option value={30}>Last 30 days</option><option value={90}>Last 90 days</option></select></label>
    <label>From<input type="date" value={start} onChange={(e)=>{setStart(e.target.value);setOffset(0)}} /></label><label>To<input type="date" value={end} onChange={(e)=>{setEnd(e.target.value);setOffset(0)}} /></label>
    <button onClick={()=>setRefresh((n)=>n+1)} disabled={loading}>Refresh statistics</button><button onClick={download} disabled={!report || loading}>Export aggregate CSV</button>
  </div><p className="partner-help">Up to 90 days. Unique accounts include only people who allow account-linked analytics. Admin previews, Platform Admins and FP TEST are excluded. Times below use UK time.</p>
    {error && <p role="alert">{error}</p>}{loading && <p role="status">Loading statistics...</p>}
    {report && <><div className="partner-metrics">{[['Views',summary.views],['Clicks',summary.clicks],['Unique consenting accounts',summary.accounts],['Click-through rate',summary.views ? `${(summary.clicks/summary.views*100).toFixed(1)}%`:'0%']].map(([label,value])=><div key={label}><strong>{value || 0}</strong><span>{label}</span></div>)}</div>
    <div className="partner-table-wrap"><table><thead><tr><th>Partner</th><th>Views</th><th>Clicks</th><th>Unique accounts</th></tr></thead><tbody>{report.offers.map((o)=><tr key={o.item_id}><td>{o.title}</td><td>{o.views}</td><td>{o.clicks}</td><td>{o.accounts}</td></tr>)}</tbody></table>{!report.offers.length && <p>No activity in this period.</p>}</div>
    <h3>Clicks by time of day</h3><div className="partner-hours">{Array.from({length:24},(_,hour)=>{const count=report.hours.find((h)=>h.hour===hour)?.clicks || 0;return <div key={hour} title={`${hour}:00 UK time: ${count} clicks`}><span>{count}</span><div style={{height:`${Math.max(3,65*count/Math.max(1,...report.hours.map((h)=>h.clicks)))}px`}} /><small>{String(hour).padStart(2,'0')}</small></div>})}</div>
    <p>{report.platforms.map((p)=>`${p.platform}: ${p.clicks} clicks`).join(' | ') || 'No platform activity yet.'}</p>
    <label className="partner-check"><input type="checkbox" checked={accounts} onChange={(e)=>{setAccounts(e.target.checked);setOffset(0)}} /> Show restricted account activity</label>
    {accounts && <><p className="partner-help">For authorised Platform Admin use only. This is the signed-in account, not the active player. Account details are excluded from exports.</p><div className="partner-table-wrap"><table><thead><tr><th>Account</th><th>Partner</th><th>Time (UK)</th><th>Platform</th></tr></thead><tbody>{report.activity.map((e,i)=><tr key={i}><td>{e.account_name || 'Account'}<small>{e.account_id}</small></td><td>{e.item_title}</td><td>{displayTime(e.created_at)}</td><td>{e.platform}</td></tr>)}</tbody></table></div><div className="partner-toolbar"><button disabled={!offset || loading} onClick={()=>setOffset(Math.max(0,offset-100))}>Previous 100</button><button disabled={report.activity.length<100 || loading} onClick={()=>setOffset(offset+100)}>Next 100</button></div></>}
    </>}
  </section>
}

export function PlatformPartnersSection() {
  const [app,setApp]=useState('parent')
  return <div className="partners-admin"><div className="partner-toolbar" aria-label="Partner app"><button aria-pressed={app==='parent'} onClick={()=>setApp('parent')}>Parent app</button><button aria-pressed={app==='coach'} onClick={()=>setApp('coach')}>Coach app</button></div><div hidden={app!=='parent'}><PartnerEditor app="parent" /></div><div hidden={app!=='coach'}><PartnerEditor app="coach" /></div></div>
}

export function PartnerEditor({ app, api = defaultApi }) {
  const [record,setRecord]=useState(null)
  const [items,setItems]=useState([])
  const [selected,setSelected]=useState('')
  const [cells,setCells]=useState([])
  const [rows,setRows]=useState(8)
  const [busy,setBusy]=useState(false)
  const [error,setError]=useState('')
  const [message,setMessage]=useState('')
  const [sourceUrl,setSourceUrl]=useState('')
  const [preview,setPreview]=useState(false)
  const [mode,setMode]=useState('editor')
  const [dirty,setDirty]=useState(false)
  const [publishConfirm,setPublishConfirm]=useState(false)
  const [version,setVersion]=useState('')
  const anchor=useRef(null)
  const dragId=useRef('')
  const uploadInput=useRef(null)
  const item=items.find((i)=>i.id===selected)
  function accept(next) {setRecord(next);setItems(next.draft.items);setDirty(false);setRows(Math.max(8,...next.draft.items.map((i)=>i.y+i.h)))}
  useEffect(()=>{let cancelled=false;api.managePartners(app).then((next)=>{if(!cancelled)accept(next)}).catch((e)=>{if(!cancelled)setError(e.message)});return()=>{cancelled=true}},[app,api])
  useEffect(()=>{if(!dirty)return;const warn=(e)=>{e.preventDefault();e.returnValue=''};window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn)},[dirty])
  async function action(name,payload={}) {
    setBusy(true);setError('');setMessage('')
    try {const next=await api.managePartners(app,name,{revision:record.revision,...payload});if(name==='hide'||name==='resolve'){setRecord(next);if(name==='hide')setItems((previous)=>previous.map((i)=>i.id===payload.itemId?{...i,hidden:true}:i))}else accept(next);setMessage(name==='publish' ? `${app==='parent'?'Parent':'Coach'} layout is published.` : name==='hide'?'Offer hidden from the live page.':name==='restore'?'Previous layout restored to draft. Preview and publish when ready.':'Draft saved.');setPublishConfirm(false)} catch(e){setError(e.message)} finally{setBusy(false)}
  }
  function change(next) {setItems(next);setDirty(true);setError('');setMessage('')}
  function update(patch) {change(items.map((i)=>i.id===selected?{...i,...patch}:i))}
  async function addFiles(files, firstRect) {
    setBusy(true);setError('');let next=[...items]
    try {
      for (let index=0;index<files.length;index++) {
        const file=files[index]
        const rect=index===0 && firstRect ? firstRect : index===0 && cells.length ? partnerRect(cells) : findPartnerSpace(next)
        const imageUrl=await api.uploadPartnerImage(file)
        const title=typeof file==='string'?'New partner':file.name.replace(/\.[^.]+$/,'')
        const added={id:crypto.randomUUID(),...rect,title,alt:title,imageUrl,url:'',sponsored:false,hidden:false,startsAt:'',endsAt:''}
        validatePartnerLayout({items:[...next,added]});next=[...next,added];change(next);setSelected(added.id);setRows(Math.max(rows,rect.y+rect.h))
      }
      setCells([]);setSourceUrl('')
    }catch(e){setError(e.message)}finally{setBusy(false)}
  }
  function move(id,cell) {
    const moved=items.find((i)=>i.id===id);if(!moved)return
    const next=items.map((i)=>i.id===id?{...i,x:cell%4,y:Math.floor(cell/4)}:i)
    try{validatePartnerLayout({items:next});change(next);setSelected(id)}catch(e){setError(e.message)}
  }
  const selection=partnerRect(cells)
  const occupied=(x,y)=>items.some((i)=>x>=i.x&&x<i.x+i.w&&y>=i.y&&y<i.y+i.h)
  return <><div className="partner-toolbar"><button aria-pressed={mode==='editor'} onClick={()=>setMode('editor')}>Layout editor</button><button aria-pressed={mode==='stats'} onClick={()=>setMode('stats')}>Statistics</button></div>
  {mode==='stats'?<PartnerAnalytics app={app} api={api}/>:<>
  {error && <p className="partner-error" role="alert">{error}</p>}{message && <p role="status" className="partner-success">{message}</p>}
  {!record ? <p>Loading partner editor...</p> : <>
  <div className="partner-toolbar"><button disabled={busy} onClick={()=>{try{validatePartnerLayout({items});void action('save',{layout:{items}})}catch(e){setError(e.message)}}}>Save draft</button><button disabled={busy} onClick={()=>setPreview(!preview)}>{preview?'Close preview':'Preview page'}</button><button className="partner-primary" disabled={busy} onClick={()=>{try{validatePartnerLayout({items});setPublishConfirm(true);setPreview(true)}catch(e){setError(e.message)}}}>Publish layout</button><span>{busy?'Working...':dirty?'Unsaved changes':`Saved revision ${record.revision}`}</span></div>
  {publishConfirm && <div className="partner-panel" role="region" aria-label="Confirm publication"><p>Publish these images and links to the {app==='parent'?'Parent':'Coach'} app? Check the preview and confirm you have permission to use the images and that the offers suit the audience.</p><div className="partner-toolbar"><button disabled={busy} className="partner-primary" onClick={()=>void action('publish',{layout:{items}})}>Confirm publish</button><button onClick={()=>setPublishConfirm(false)}>Cancel</button></div></div>}
  {preview && <PartnerPreview items={items}/>}
  <fieldset disabled={busy} className="partner-editor-fields"><div className="partner-editor-columns"><section className="partner-panel"><h2>{app==='parent'?'Parent':'Coach'} partner grid</h2><p className="partner-help">Select a cell, drag across several cells, or Shift-click a range. Upload images into that space. Drag an existing image to an empty cell to move it. Use the position fields for keyboard control.</p>
  <div className="partner-grid" aria-label="Partner image grid" style={{gridTemplateRows:`repeat(${rows},72px)`}} onPointerUp={()=>{anchor.current=null}} onPointerLeave={()=>{anchor.current=null}}>
    {Array.from({length:rows*4},(_,cell)=>{const x=cell%4,y=Math.floor(cell/4),inSelection=cells.length&&x>=selection.x&&x<selection.x+selection.w&&y>=selection.y&&y<selection.y+selection.h;return <button key={cell} type="button" className={`partner-cell ${inSelection?'selected':''}`} style={{gridColumn:x+1,gridRow:y+1}} aria-label={`Row ${y+1}, column ${x+1}`} aria-pressed={Boolean(inSelection)} disabled={busy || occupied(x,y)} onPointerDown={(e)=>{if(e.button!==0)return;anchor.current=cell;setCells(e.shiftKey&&cells.length?[cells[0],cell]:[cell]);setSelected('')}} onPointerEnter={(e)=>{if(e.buttons===1&&anchor.current!==null)setCells([anchor.current,cell])}} onClick={(e)=>{if(e.detail===0){setCells(e.shiftKey&&cells.length?[cells[0],cell]:[cell]);setSelected('')}}} onDragOver={(e)=>e.preventDefault()} onDrop={(e)=>{e.preventDefault();if(busy)return;if(dragId.current){move(dragId.current,cell);dragId.current=''}else{setCells([cell]);void addFiles(Array.from(e.dataTransfer.files),partnerRect([cell]))}}}>{y+1}:{x+1}</button>})}
    {items.map((i)=><button key={i.id} type="button" className={`partner-tile ${selected===i.id?'selected':''} ${i.hidden?'hidden-offer':''}`} style={gridStyle(i)} draggable={!busy} disabled={busy} onDragStart={(e)=>{dragId.current=i.id;e.dataTransfer.setData('text/plain',i.id);e.dataTransfer.effectAllowed='move'}} onDragEnd={()=>{dragId.current=''}} onClick={()=>{setSelected(i.id);setCells([])}} aria-label={`Edit ${i.title}`}><img src={i.imageUrl} alt={i.alt} draggable={false}/><span>{i.title}{i.hidden?' (hidden)':''}</span></button>)}
  </div><div className="partner-toolbar"><button disabled={rows>=24 || busy} onClick={()=>setRows(Math.min(24,rows+4))}>Add grid rows</button><button onClick={()=>setCells([])}>Clear selection</button></div>
  <div className="partner-drop" onDragOver={(e)=>e.preventDefault()} onDrop={(e)=>{e.preventDefault();if(!busy)void addFiles(Array.from(e.dataTransfer.files))}}><p>Drop partner images here</p><button disabled={busy} onClick={()=>uploadInput.current?.click()}>Choose images</button><input ref={uploadInput} type="file" accept="image/png,image/jpeg,image/webp" multiple hidden onChange={(e)=>{void addFiles(Array.from(e.target.files));e.target.value=''}}/><small>PNG, JPG or WebP. Up to 2MB and 2048 x 2048 pixels per image.</small></div>
  <label>Image URL<input type="url" value={sourceUrl} placeholder="https://partner.example/image.png" onChange={(e)=>setSourceUrl(e.target.value)}/></label><button disabled={busy || !sourceUrl} onClick={()=>void addFiles([sourceUrl])}>Import image from URL</button><p className="partner-help">Images are copied into our image library so the source website does not receive app image requests.</p>
  </section><aside className="partner-panel"><h2>{item?'Image details':'Select an image'}</h2>{item ? <div className="partner-fields">
    <label>Partner name<input value={item.title} maxLength={120} onChange={(e)=>update({title:e.target.value})}/></label><label>Image description<textarea value={item.alt} maxLength={500} onChange={(e)=>update({alt:e.target.value})}/></label><label>Website to open when tapped<input type="url" value={item.url} placeholder="https://partner.example" onChange={(e)=>update({url:e.target.value})}/></label><p className="partner-help">Leave blank for an image without a website link. Check digital-product offers against store rules before publishing.</p>
    <div className="partner-position">{[['x','Column',1,4],['y','Row',1,24],['w','Width in cells',1,4],['h','Height in cells',1,24]].map(([key,label,min,max])=><label key={key}>{label}<input type="number" min={min} max={max} value={item[key]+(['x','y'].includes(key)?1:0)} onChange={(e)=>update({[key]:Number(e.target.value)-(['x','y'].includes(key)?1:0)})}/></label>)}</div>
    <label>Start (your local time)<input type="datetime-local" value={localInput(item.startsAt)} onChange={(e)=>update({startsAt:e.target.value?new Date(e.target.value).toISOString():''})}/></label><label>End (your local time)<input type="datetime-local" value={localInput(item.endsAt)} onChange={(e)=>update({endsAt:e.target.value?new Date(e.target.value).toISOString():''})}/></label>
    <label className="partner-check"><input type="checkbox" checked={item.sponsored} onChange={(e)=>update({sponsored:e.target.checked})}/>Paid placement: show Sponsored label</label><label className="partner-check"><input type="checkbox" checked={item.hidden} onChange={(e)=>update({hidden:e.target.checked})}/>Hide in this draft</label>
    <button disabled={busy || !record.published.items.some((i)=>i.id===item.id)} onClick={()=>void action('hide',{itemId:item.id})}>Hide this offer immediately</button><button disabled={busy} onClick={()=>{change(items.filter((i)=>i.id!==selected));setSelected('')}}>Remove from draft</button>
  </div>:<p className="partner-help">Click an image in the grid to edit its link, size, schedule and description.</p>}
  <h3>Restore a previous layout</h3><select aria-label="Previous published layout" value={version} onChange={(e)=>setVersion(e.target.value)}><option value="">Choose a version</option>{record.versions.map((v)=><option key={v.id} value={v.id}>{displayTime(v.created_at)}</option>)}</select><button disabled={busy || !version} onClick={()=>void action('restore',{versionId:Number(version)})}>Restore to draft</button><p className="partner-help">The last 20 published layouts are available. Restoration creates a draft for you to review.</p>
  </aside></div></fieldset>
  <section className="partner-panel"><h2>Reported offers</h2>{!record.reports.length?<p>No unresolved reports.</p>:record.reports.map((r)=><article key={r.id}><h3>{r.item_title}</h3><p>{r.reason}</p><small>{displayTime(r.created_at)}</small><div className="partner-toolbar"><button disabled={busy} onClick={()=>void action('hide',{itemId:r.item_id})}>Hide reported offer</button><button disabled={busy} onClick={()=>void action('resolve',{reportId:r.id})}>Mark resolved</button></div></article>)}</section>
  </>}
  </>}
  </>
}
