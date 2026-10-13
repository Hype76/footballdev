import AsyncStorage from '@react-native-async-storage/async-storage'
import { getMobileRuntimeConfig } from './config'
import { createTeamLeagueStorage } from './teamLeagueStorageCore'

const config = getMobileRuntimeConfig('shared')
export const mobileTeamLeagueStorage = createTeamLeagueStorage(AsyncStorage, `fp.league.v1:${config.supabaseUrl}:`)
