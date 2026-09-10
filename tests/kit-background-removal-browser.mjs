import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { build } from 'vite'
import { chromium } from 'playwright'

const root = process.cwd(), out = path.resolve('output/kit-background-runtime')
await mkdir('output', { recursive: true })
await writeFile('output/kit-background-entry.js', `
import { removeKitBackground } from '../src/lib/kit-background-removal.js';
window.runRemoval=async(cancel=false)=>{
 const c=document.createElement('canvas');c.width=c.height=512;const x=c.getContext('2d');x.fillStyle='white';x.fillRect(0,0,512,512);
 x.fillStyle='#174c92';x.beginPath();[[190,70],[140,85],[65,170],[125,220],[155,190],[155,435],[357,435],[357,190],[387,220],[447,170],[372,85],[322,70],[300,95],[212,95]].forEach(([a,b],i)=>i?x.lineTo(a,b):x.moveTo(a,b));x.closePath();x.fill();x.fillStyle='white';x.fillRect(243,100,26,330);
 const image=new Image();image.src=c.toDataURL();await image.decode();window.original=image.src;
 const job=removeKitBackground(image);if(cancel)job.cancel();const blob=await job.promise;const result=new Image();result.src=URL.createObjectURL(blob);await result.decode();x.clearRect(0,0,512,512);x.drawImage(result,0,0);URL.revokeObjectURL(result.src);
 document.getElementById('result').src=c.toDataURL();return {corner:[...x.getImageData(5,5,1,1).data],kit:[...x.getImageData(200,250,1,1).data],stripe:[...x.getImageData(255,250,1,1).data]};
};
document.getElementById('eval-check').onclick=()=>{try{new Function('return 1')();window.evalBlocked=false}catch{window.evalBlocked=true}};
`)
await writeFile('output/kit-background-test.html', '<html><body><button id="eval-check">Check script policy</button><img id="result" width="320"><script type="module" src="./kit-background-entry.js"></script></body></html>')
await build({ configFile: false, logLevel: 'silent', publicDir: path.resolve('public'), build: { outDir: out, emptyOutDir: true, rollupOptions: { input: path.resolve('output/kit-background-test.html') } } })
const csp = (await readFile('netlify.toml', 'utf8')).match(/Content-Security-Policy = "([^"]+)"/)[1].replace('; upgrade-insecure-requests', '')
const server = createServer(async (req, res) => {
  const name = decodeURIComponent(new URL(req.url, 'http://local').pathname)
  const file = path.resolve(out, '.' + name)
  if (!file.startsWith(out + path.sep)) { res.writeHead(404);res.end();return }
  try { const bytes = await readFile(file);res.writeHead(200, { 'Content-Type': file.endsWith('.html') ? 'text/html' : file.endsWith('.wasm') ? 'application/wasm' : file.endsWith('.js') ? 'text/javascript' : 'application/octet-stream', 'Content-Security-Policy': csp });res.end(bytes) } catch { res.writeHead(404);res.end() }
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const origin = `http://127.0.0.1:${server.address().port}`
const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage()
  const requests = []
  page.on('request', request => requests.push(request.url()))
  await page.goto(origin + '/output/kit-background-test.html')
  await page.waitForFunction(() => window.runRemoval)
  assert.equal(requests.some(url => /\.onnx|\.wasm/.test(url)), false, 'Model and runtime are not downloaded until requested')
  await page.getByRole('button', { name: 'Check script policy' }).click()
  assert.equal(await page.evaluate(() => window.evalBlocked), true, 'JavaScript eval stays blocked')
  const result = await page.evaluate(() => window.runRemoval())
  assert.ok(result.corner[3] < 15, 'White background becomes transparent')
  assert.ok(result.kit[3] > 220, 'Kit remains opaque')
  assert.deepEqual(result.kit.slice(0, 3), [23, 76, 146], 'Kit colours are preserved')
  assert.ok(result.stripe[3] > 220, 'White details inside the kit are preserved')
  await page.screenshot({ path: 'output/kit-background-actual-model.png' })
  assert.equal(await page.evaluate(() => window.runRemoval(true).then(() => 'unexpected', error => error.name)), 'AbortError')
  assert.ok(requests.every(url => url.startsWith(origin) || url.startsWith('data:') || url.startsWith('blob:')), 'No image service or external model host is contacted')
  console.log('PASS: actual self-hosted U2NETP model and WASM worker under production CSP; transparent background, retained white details and kit colours, lazy loading and immediate cancellation; JavaScript eval remains blocked.')
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)) }
