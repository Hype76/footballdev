import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import sharp from 'sharp'
import pathSupport from '../apps/parent-mobile/node_modules/@react-native/assets-registry/path-support.js'

test('shared logo path differs from the resource embedded in Parent Android build 44', ()=>{
  const metadata={name:'football-player-logo',type:'png'}
  const embedded=pathSupport.getAndroidResourceIdentifier({...metadata,httpServerLocation:'/assets/assets'})
  const shared=pathSupport.getAndroidResourceIdentifier({...metadata,httpServerLocation:'/assets/../mobile-core/assets'})
  assert.equal(embedded,'assets_footballplayerlogo')
  assert.equal(shared,'_mobilecore_assets_footballplayerlogo')
  assert.notEqual(shared,embedded,'An identical file hash cannot make the new resource name exist in the installed binary')
})

test('white reverse uses the existing FP green on the P and keeps the F and ring black', async () => {
  const reverse = JSON.parse(await readFile(new URL('../apps/mobile-core/assets/football-player-reverse-source.json', import.meta.url), 'utf8'))
  const bytes = Buffer.from(reverse.uri.split(',')[1], 'base64')
  const { data, info } = await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const pixel = (x, y) => [...data.subarray((y * info.width + x) * 4, (y * info.width + x) * 4 + 4)]
  assert.deepEqual(pixel(225, 80), [143, 208, 7, 255])
  assert.deepEqual(pixel(90, 80), [17, 17, 17, 255])
  assert.deepEqual(pixel(137, 13), [17, 17, 17, 255])
  assert.equal(pixel(137, 42)[3], 0)
})

test('Android loader source contains the exact FP artwork without native resource resolution', async()=>{
  const asset=JSON.parse(await readFile(new URL('../apps/mobile-core/assets/football-player-logo.android-source.json',import.meta.url),'utf8'))
  assert.equal(asset.width,512)
  assert.equal(asset.height,512)
  assert.ok(asset.uri.startsWith('data:image/png;base64,'))
  const bytes=Buffer.from(asset.uri.split(',')[1],'base64')
  const original=await readFile(new URL('../apps/mobile-core/assets/football-player-logo.png',import.meta.url))
  assert.deepEqual(bytes,original,'Packaging must preserve the original logo pixel for pixel')
  // React Native passes object sources straight through. No Metro ID, asset map,
  // resource name, network request, or old Android binary is needed to load it.
  assert.equal(typeof asset,'object')
  assert.equal(bytes.readUInt32BE(16),asset.width)
  assert.equal(bytes.readUInt32BE(20),asset.height)
})
