import { useEffect, useRef, useState } from 'react'
import { ActivityIndicator, AppState, Dimensions, Image, Linking, Modal, Platform, Pressable, Text, TextInput, View } from 'react-native'
import { randomUUID } from 'expo-crypto'
import { supabase } from './supabase'
import { safePartnerUrl } from '../../../src/lib/partners'

export function PartnersBanner({ onPress }) {
  return <Pressable accessibilityRole="button" accessibilityLabel="Partners and Special Offers" accessibilityHint="Opens partners and offers" onPress={onPress} style={({ pressed }) => ({ minHeight: 156, borderRadius: 16, overflow: 'hidden', justifyContent: 'center', backgroundColor: '#071d33', opacity: pressed ? 0.85 : 1 })}>
    <Image accessible={false} source={require('../assets/partners-banner.png')} resizeMode="cover" style={{ position: 'absolute', width: '100%', height: '100%' }} />
    <View style={{ width: '65%', padding: 20, gap: 10 }}>
      <Text style={{ color: '#ffffff', fontSize: 23, lineHeight: 28, fontWeight: '800' }}>Partners &amp;{ '\n' }Special Offers</Text>
      <Text style={{ color: '#ffffff', fontSize: 13, fontWeight: '600' }}>Explore what’s on offer →</Text>
    </View>
  </Pressable>
}

const actionStyle = { minHeight:44, padding:10, justifyContent:'center', borderRadius:9, backgroundColor:'#e5f3ec' }
const actionText = { color:'#07563d', fontWeight:'700', fontSize:13 }

function PartnerTile({ item, size, onClick, onView, onReport }) {
  const tile=useRef(null)
  const viewed=useRef(false)
  const [loaded,setLoaded]=useState(false)
  const [failed,setFailed]=useState(false)
  useEffect(()=>{
    if (!loaded || viewed.current) return
    let visibleSince=0
    const timer=setInterval(()=>{
      if (AppState.currentState && AppState.currentState!=='active') {visibleSince=0;return}
      tile.current?.measureInWindow((x,y,w,h)=>{
        const window=Dimensions.get('window')
        const visibleWidth=Math.max(0,Math.min(x+w,window.width)-Math.max(0,x))
        const visibleHeight=Math.max(0,Math.min(y+h,window.height)-Math.max(0,y))
        if (w*h>0 && visibleWidth*visibleHeight>=w*h*0.5) {
          if (!visibleSince) visibleSince=Date.now()
          if (Date.now()-visibleSince>=1000 && !viewed.current) {viewed.current=true;onView(item);clearInterval(timer)}
        } else visibleSince=0
      })
    },500)
    return()=>clearInterval(timer)
  },[item,loaded,onView])
  return <View ref={tile} collapsable={false} style={{position:'absolute',left:item.x*(size+6),top:item.y*(size+6),width:item.w*(size+6)-6,height:item.h*(size+6)-6,borderRadius:10,overflow:'hidden',backgroundColor:'#fff',borderWidth:1,borderColor:'#dce7e1'}}>
    <Pressable accessibilityRole={item.url?'link':'image'} accessibilityLabel={item.alt} accessibilityHint={item.url?'Opens the partner website in your browser':undefined} disabled={!item.url} onPress={()=>onClick(item)} style={{flex:1}}>
      {failed?<Text style={{color:'#364d42',padding:8}}>{item.title}</Text>:<Image source={{uri:item.imageUrl}} accessibilityIgnoresInvertColors resizeMode="contain" onLoad={()=>setLoaded(true)} onError={()=>setFailed(true)} style={{width:'100%',height:'100%'}}/>}
      {item.sponsored && <Text style={{position:'absolute',bottom:3,left:3,fontSize:10,backgroundColor:'#fffdf1',color:'#314337',padding:3,borderRadius:3}}>Sponsored</Text>}
    </Pressable>
    <Pressable accessibilityRole="button" accessibilityLabel={`Report ${item.title}`} onPress={()=>onReport(item)} style={{minHeight:32,justifyContent:'center',paddingHorizontal:6,backgroundColor:'#f1f6f3'}}><Text style={{fontSize:11,color:'#375347',textAlign:'center'}}>Report offer</Text></Pressable>
  </View>
}

export function PartnersScreen({ textStyle, headingStyle, appRole }) {
  const [feed,setFeed]=useState(null)
  const [error,setError]=useState('')
  const [width,setWidth]=useState(0)
  const [preferenceOpen,setPreferenceOpen]=useState(false)
  const [reporting,setReporting]=useState(null)
  const [reason,setReason]=useState('')
  const [busy,setBusy]=useState(false)
  const [notice,setNotice]=useState('')
  const [now,setNow]=useState(()=>Date.now())
  async function load() {
    const {data,error:err}=await supabase.rpc('partner_feed',{p_app:appRole})
    if(err){setError('Offers could not be loaded. Please try again.');return}
    setFeed(data);setNow(Date.now());setError('')
  }
  useEffect(()=>{
    let stopped=false
    const refresh=async()=>{
      const {data,error:err}=await supabase.rpc('partner_feed',{p_app:appRole})
      if(stopped)return
      if(err){setError('Offers could not be loaded. Please try again.');return}
      setFeed(data);setNow(Date.now());setError('')
    }
    void refresh()
    const timer=setInterval(()=>{if(!AppState.currentState||AppState.currentState==='active')void refresh()},60000)
    const subscription=AppState.addEventListener('change',(state)=>{if(state==='active')void refresh()})
    return()=>{stopped=true;clearInterval(timer);subscription.remove()}
  },[appRole])
  async function interaction(item,kind,reportReason='') {
    return supabase.rpc('partner_interaction',{p_app:appRole,p_item_id:item.id,p_kind:kind,p_platform:Platform.OS==='web'?'web':Platform.OS,p_event_id:randomUUID(),p_reason:reportReason})
  }
  async function open(item) {
    const {data:latest,error:feedError}=await supabase.rpc('partner_feed',{p_app:appRole})
    if(feedError){setNotice('Please reconnect and try this offer again.');return}
    const current=latest?.items?.find((offer)=>offer.id===item.id)
    const url=safePartnerUrl(current?.url)
    if (!url) {setNotice('This website address is unavailable.');return}
    try {await Linking.openURL(url);void interaction(item,'click')}catch{setNotice('The website could not be opened. Please try again.')}
  }
  async function preference(allow) {
    setBusy(true)
    const {error:err}=await supabase.rpc('partner_preference',{p_app:appRole,p_allow:allow})
    if(err)setNotice('Your preference could not be saved. Please try again.')
    else{setFeed((f)=>({...f,linkedAnalytics:allow}));setPreferenceOpen(false);setNotice(allow?'Account-linked analytics enabled.':'Activity will not be linked to your account. Existing account links have been removed.')}
    setBusy(false)
  }
  async function sendReport() {
    setBusy(true)
    const {data,error:err}=await interaction(reporting,'report',reason)
    setBusy(false)
    if(err||!data){setNotice('Your report could not be sent. Please try again.');return}
    setReporting(null);setReason('');setNotice('Thank you. Your report has been sent to Platform Admin.')
  }
  const items=(feed?.items || []).filter((item)=>!item.hidden&&(!item.startsAt||Date.parse(item.startsAt)<=now)&&(!item.endsAt||Date.parse(item.endsAt)>now))
  const size=(width-18)/4
  return <View style={{gap:16,paddingVertical:8}} onLayout={(e)=>setWidth(e.nativeEvent.layout.width)}>
    <Text accessibilityRole="header" style={headingStyle}>Partners &amp; Special Offers</Text>
    {error?<View><Text style={textStyle}>{error}</Text><Pressable style={actionStyle} onPress={()=>void load()} accessibilityRole="button"><Text style={actionText}>Retry</Text></Pressable></View>:!feed?<ActivityIndicator accessibilityLabel="Loading partner offers"/>:!items.length?<Text style={textStyle}>Our partners and their offers will appear here. Check back soon.</Text>:<>
      {width>0 && <View style={{height:Math.max(...items.map((i)=>i.y+i.h))*(size+6)-6}}>{items.map((item)=><PartnerTile key={item.id} item={item} size={size} onClick={open} onView={(i)=>{void interaction(i,'view')}} onReport={(i)=>{setReporting(i);setReason('');setNotice('')}}/>)}</View>}
      <Text style={[textStyle,{fontSize:12}]}>Offers open on the partner website. We count views and clicks to understand which offers are useful.</Text>
    </>}
    {feed && (items.length>0 || feed.linkedAnalytics!==null) && <>
      {(feed.linkedAnalytics===null || preferenceOpen)?<View style={{gap:10,padding:14,borderRadius:12,backgroundColor:'#f0f7f3'}}><Text style={{color:'#233e31',fontSize:13,lineHeight:19}}>Allow Football Player to link partner views and clicks to your account for up to 90 days? Only authorised Platform Admins can see this activity. We do not share your account details with partners. You can change this choice here.</Text><Pressable style={actionStyle} disabled={busy} onPress={()=>void preference(true)} accessibilityRole="button"><Text style={actionText}>Allow account-linked analytics</Text></Pressable><Pressable style={actionStyle} disabled={busy} onPress={()=>void preference(false)} accessibilityRole="button"><Text style={actionText}>Keep my activity unlinked</Text></Pressable></View>:<Pressable style={actionStyle} accessibilityRole="button" onPress={()=>setPreferenceOpen(true)}><Text style={actionText}>Analytics preference: {feed.linkedAnalytics?'account-linked':'unlinked'}</Text></Pressable>}
    </>}
    {!!notice && <Text accessibilityRole="alert" style={textStyle}>{notice}</Text>}
    <Modal visible={Boolean(reporting)} transparent animationType="fade" onRequestClose={()=>setReporting(null)}><View style={{flex:1,justifyContent:'center',padding:24,backgroundColor:'#0008'}}><View style={{backgroundColor:'white',borderRadius:16,padding:20,gap:14}}><Text style={{fontSize:20,fontWeight:'800',color:'#182e23'}}>Report {reporting?.title}</Text><Text style={{color:'#405b4c'}}>Tell us what is wrong with this offer. Avoid including private player information.</Text><TextInput accessibilityLabel="Reason for reporting" value={reason} onChangeText={setReason} multiline maxLength={1000} placeholder="Describe the issue" placeholderTextColor="#65796e" style={{minHeight:100,borderWidth:1,borderColor:'#b8ccc0',borderRadius:8,padding:12,color:'#182e23',textAlignVertical:'top'}}/><Pressable style={actionStyle} accessibilityRole="button" disabled={busy||reason.trim().length<3} onPress={()=>void sendReport()}><Text style={actionText}>{busy?'Sending...':'Send report'}</Text></Pressable><Pressable style={actionStyle} accessibilityRole="button" onPress={()=>setReporting(null)}><Text style={actionText}>Cancel</Text></Pressable>{!!notice&&<Text style={{color:'#9b1c1c'}}>{notice}</Text>}</View></View></Modal>
  </View>
}
