import { registerRootComponent } from 'expo'
import { registerLiveMatchBackground } from '../mobile-core/src/liveMatchBackground'
import App from './App'

void registerLiveMatchBackground().catch(() => {})
registerRootComponent(App)
