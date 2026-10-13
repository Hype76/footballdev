import { requireOptionalNativeModule } from 'expo'
import * as Crypto from 'expo-crypto'
import { getMobileRuntimeConfig } from './config'
import { createKitImageStorage } from './kitImageStorageCore'

// ExponentFileSystem is already linked by the SDK in both existing binaries.
// Use the optional bridge so unsupported surfaces keep their normal image path.
const config = getMobileRuntimeConfig('shared')
export const mobileKitImageStorage = createKitImageStorage({
  fileSystem: requireOptionalNativeModule('ExponentFileSystem'),
  digest: uri => Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, uri),
  origin: config.supabaseUrl,
})
