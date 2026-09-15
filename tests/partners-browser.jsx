import { createRoot } from 'react-dom/client'
import { PartnerEditor } from '../src/components/platform/PlatformPartnersSection.jsx'

let record={app:'parent',revision:0,draft:{items:[]},published:{items:[]},versions:[],reports:[]}
const history=new Map()
const api={
  async managePartners(app,action='load',payload={}) {
    if(action==='save'||action==='publish')record={...record,revision:record.revision+1,draft:structuredClone(payload.layout)}
    if(action==='publish') {const id=record.revision;history.set(id,record.published);record.versions.unshift({id,created_at:new Date().toISOString()});record.published=structuredClone(payload.layout)}
    if(action==='restore')record={...record,revision:record.revision+1,draft:structuredClone(history.get(payload.versionId))}
    if(action==='hide') {record={...record,revision:record.revision+1};for(const layout of [record.draft,record.published])layout.items=layout.items.map((i)=>i.id===payload.itemId?{...i,hidden:true}:i)}
    return structuredClone(record)
  },
  async uploadPartnerImage(){return 'https://footballplayer.online/football-player-logo.png'},
  async partnerStats(){return {summary:{views:50,clicks:10,accounts:4},offers:[{item_id:'test',title:'FP TEST sample',views:50,clicks:10,accounts:4}],hours:[{hour:12,clicks:10}],platforms:[{platform:'ios',views:50,clicks:10}],activity:[]}}
}
createRoot(document.getElementById('root')).render(<main className="partners-admin"><h1>FP TEST partner editor</h1><p>This isolated fixture uses synthetic data only. Nothing is saved to production.</p><PartnerEditor app="parent" api={api}/></main>)
