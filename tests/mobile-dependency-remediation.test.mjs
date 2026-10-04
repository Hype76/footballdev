import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'

const parentRequire = createRequire(new URL('../apps/parent-mobile/package.json', import.meta.url))
const metroRoot = path.dirname(parentRequire.resolve('metro/package.json'))
const assets = parentRequire(path.join(metroRoot, 'src', 'Assets.js'))
const imagePath = path.resolve('public/apple-touch-icon.png')

test('Metro still derives dimensions from image buffers and real file-based asset metadata', async () => {
  const content = await readFile(imagePath)
  const expected = { width: content.readUInt32BE(16), height: content.readUInt32BE(20) }
  assert.deepEqual(assets.getAssetSize('png', content, imagePath), expected)
  const metadata = await assets.getAssetData(imagePath, 'apple-touch-icon.png', [], null, '/assets')
  assert.equal(metadata.width, expected.width)
  assert.equal(metadata.height, expected.height)
  assert.ok(metadata.files.includes(imagePath))
  assert.deepEqual(metadata.scales, [1])
})

test('Metro rejects zero-sized ICNS, HEIF and JXL boxes without blocking its process', () => {
  const icns = Buffer.alloc(16)
  icns.write('icns', 0); icns.writeUInt32BE(16, 4); icns.write('icp4', 8)
  const heif = Buffer.alloc(32)
  heif.write('ftyp', 4); heif.write('heic', 8)
  const jxl = Buffer.alloc(32)
  jxl.writeUInt32BE(12, 0); jxl.write('JXL ', 4)
  jxl.write('ftyp', 16); jxl.write('jxl ', 20)
  const code = `
    const {createRequire}=require('node:module');
    const path=require('node:path');
    const r=createRequire(path.resolve('apps/parent-mobile/package.json'));
    const a=r(path.join(path.dirname(r.resolve('metro/package.json')),'src','Assets.js'));
    try { a.getAssetSize('png',Buffer.from(process.argv[1],'base64'),'synthetic.png'); process.exit(2) }
    catch { console.log('rejected') }
  `
  for (const [format, content] of [['ICNS', icns], ['HEIF', heif], ['JXL', jxl]]) {
    const result = spawnSync(process.execPath, ['-e', code, content.toString('base64')], { encoding: 'utf8', timeout: 5000 })
    assert.equal(result.error, undefined, `${format} parser must terminate without timeout`)
    assert.equal(result.status, 0, `${format}: ${result.stderr}`)
    assert.equal(result.stdout.trim(), 'rejected', format)
  }
})

test('YAML retains normal aliases and limits work from empty merge sources', () => {
  const r = createRequire(parentRequire.resolve('@expo/xcpretty/package.json'))
  const yaml = r('js-yaml')
  assert.deepEqual(yaml.load('base: &base {name: player}\ncopy: *base'), { base: { name: 'player' }, copy: { name: 'player' } })
  assert.throws(() => yaml.load('sources: &sources [{}, {}, {}]\nvalue:\n  <<: *sources', { maxTotalMergeKeys: 1 }), /merge/i)
})

test('Patched glob expansion keeps React Native codegen and Expo matching contracts', () => {
  for (const packageName of ['@react-native/codegen', 'expo']) {
    const r = createRequire(parentRequire.resolve(`${packageName}/package.json`))
    const module = r('minimatch')
    const match = typeof module === 'function' ? module : module.minimatch
    const pattern = 'fixture-{home,away}-{1..2}.png'
    assert.equal(match('fixture-home-1.png', pattern), true)
    assert.equal(match('fixture-away-2.png', pattern), true)
    assert.equal(match('fixture-home-3.png', pattern), false)
    assert.equal(match('other-home-1.png', pattern), false)
  }
})
