import {useEffect,useMemo,useSyncExternalStore} from 'react'
import {Pressable,Text,TextInput,View} from 'react-native'
import * as Crypto from 'expo-crypto'
import {createTeamCoachReminderSettingsStore} from '../../../src/lib/team-coach-reminder-settings-store.js'
import {requestTeamCoachReminderPolicy} from '../../../src/lib/coach-reminder-settings.js'
import {getAccessToken} from '../../mobile-core/src/supabase'

export function CoachTeamReminderSettings({clubId,teamId,apiBaseUrl,palette}){
  const store=useMemo(()=>createTeamCoachReminderSettingsStore({clubId,teamId,createRequestId:()=>Crypto.randomUUID(),
    request:async payload=>requestTeamCoachReminderPolicy({accessToken:await getAccessToken(),apiBaseUrl,payload})}),[clubId,teamId,apiBaseUrl])
  return <CoachTeamReminderSettingsView store={store} palette={palette}/>
}

export function CoachTeamReminderSettingsView({store,palette}){
  const state=useSyncExternalStore(store.subscribe,store.getSnapshot,store.getSnapshot)
  useEffect(()=>{void store.load()},[store])
  const disabled=state.busy || state.needsReload || !state.loaded
  const row={minHeight:48,flexDirection:'row',alignItems:'center',gap:10,borderBottomWidth:1,borderBottomColor:palette.border,paddingVertical:8}
  const text={color:palette.text,flexShrink:1}
  const toggle=(label,value,onChange)=> <Pressable accessibilityRole="checkbox" aria-checked={value} aria-disabled={disabled} accessibilityLabel={label} accessibilityState={{checked:value,disabled}} disabled={disabled} onPress={()=>onChange(!value)} style={row}><Text style={text}>{value?'[x]':'[ ]'} {label}</Text></Pressable>
  const timing=(label,key)=> <View style={row}><Text style={text}>{label}</Text><TextInput accessibilityLabel={label} editable={!disabled} keyboardType="number-pad" value={state.options[key]===null?'':String(state.options[key])} onChangeText={value=>store.edit({options:{...state.options,[key]:value===''?null:Number(value)}})} style={{minHeight:44,minWidth:72,color:palette.text,borderBottomWidth:1,borderBottomColor:palette.border,padding:8}} /></View>
  return <View style={{gap:8}}>
    <Text style={text}>Shared by authorised coaches for this team. Applies to future match and training invitations.</Text>
    {!state.loaded?<Text accessibilityLiveRegion="polite" style={text}>{state.busy?'Loading team reminders...':'Team reminders could not be loaded.'}</Text>:<>
      {toggle('Remind unanswered invitations',state.options.reminderEnabled,value=>store.edit({options:{...state.options,reminderEnabled:value}}))}
      {state.options.reminderEnabled?timing('Reminder hours','reminderAfterHours'):null}
      <Text style={text}>Missed response deadline</Text>
      {[['reminders_only','Reminders only'],['exclude_from_planning','Exclude unanswered or Maybe from planning'],['automatic_not_attending','Automatically mark unanswered Not attending and notify']].map(([value,label])=><Pressable key={value} accessibilityRole="radio" aria-checked={state.options.deadlineMode===value} aria-disabled={disabled} accessibilityLabel={label} accessibilityState={{checked:state.options.deadlineMode===value,disabled}} disabled={disabled} onPress={()=>store.edit({options:{...state.options,deadlineMode:value}})} style={row}><Text style={text}>{state.options.deadlineMode===value?'(*)':'( )'} {label}</Text></Pressable>)}
      {state.options.deadlineMode!=='reminders_only'?timing('Deadline hours','deadlineAfterHours'):null}
      {toggle('Remind team coaches when squad is unselected',state.options.squadReminderEnabled,value=>store.edit({options:{...state.options,squadReminderEnabled:value}}))}
      {state.options.squadReminderEnabled?timing('Squad reminder days','squadDaysBefore'):null}
      {toggle('Enable configured team reminders and deadlines',state.optedIn,value=>store.edit({optedIn:value}))}
      <Text style={text}>Automatic Not attending is labelled as a team deadline action. Parents can correct their answer.</Text>
      {!state.deliveryEnabled?<Text style={text}>Automatic delivery is not enabled yet. Choices can be saved for later.</Text>:null}
    </>}
    {state.error?<Text accessibilityRole="alert" style={{color:palette.danger}}>{state.error}</Text>:null}
    {state.notice?<Text accessibilityLiveRegion="polite" style={text}>{state.notice}</Text>:null}
    <Pressable accessibilityRole="button" aria-disabled={disabled} disabled={disabled} onPress={()=>{void store.save()}} style={row}><Text style={text}>{state.busy?'Please wait...':'Save team reminders'}</Text></Pressable>
    <Pressable accessibilityRole="button" disabled={state.busy} onPress={()=>{void store.load()}} style={row}><Text style={text}>Reload team settings</Text></Pressable>
  </View>
}
