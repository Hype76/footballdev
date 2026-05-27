import { chromium } from 'playwright'
import { execFile } from 'node:child_process'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const outputDir = resolve(rootDir, 'public', 'onboarding')
const tempDir = resolve(rootDir, 'node_modules', '.cache', 'onboarding-videos')
const baseUrl = process.env.ONBOARDING_BASE_URL || 'http://localhost:4176'
const ffmpegPath =
  process.env.FFMPEG_PATH ||
  'ffmpeg'
const captureWidth = 1280
const captureHeight = 590
const outputHeight = 720

async function loadLocalEnv() {
  const envPath = resolve(rootDir, '.env.local')
  const envText = await readFile(envPath, 'utf8').catch(() => '')

  for (const line of envText.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) {
      continue
    }

    const separatorIndex = trimmed.indexOf('=')
    const key = trimmed.slice(0, separatorIndex).trim()
    const rawValue = trimmed.slice(separatorIndex + 1).trim()
    const value = rawValue.replace(/^['"]|['"]$/g, '')

    if (!process.env[key]) {
      process.env[key] = value
    }
  }
}

const guides = [
  {
    key: 'workspace-start',
    path: '/information',
    duration: 16,
    narration:
      'This is the Information page inside the real demo workspace. Use the guide cards, quick links, and the sidebar to move to the task you need.',
    captions: [
      ['Start from the Information page inside the real workspace.', 0, 5],
      ['Use the sidebar to move between the tools available to your role.', 5, 11],
      ['Use quick links when you need to jump straight to a common task.', 11, 16],
    ],
    points: [
      [72, 520],
      [220, 520],
      [520, 265],
      [1000, 520],
    ],
  },
  {
    key: 'teams-staff',
    path: '/teams',
    duration: 18,
    narration:
      'This is the real Team Management page. Use it to create teams, review staff allocations, and keep each staff member attached to the right team.',
    captions: [
      ['Open Team Management to review the club setup.', 0, 6],
      ['Create teams and staff logins from the real workspace tools.', 6, 12],
      ['Check allocations before staff start player work.', 12, 18],
    ],
    points: [
      [78, 272],
      [430, 260],
      [920, 360],
      [1020, 505],
    ],
  },
  {
    key: 'players',
    path: '/players/current',
    duration: 18,
    narration:
      'This is the real Current Players page. Search the list, open a player profile, and keep player details, positions, and parent contacts up to date.',
    captions: [
      ['Use Current Players to search and review your squad.', 0, 6],
      ['Open a profile for player history, contacts, and reports.', 6, 12],
      ['Archive players when they should no longer count as active.', 12, 18],
    ],
    points: [
      [82, 323],
      [465, 306],
      [805, 404],
      [1100, 500],
    ],
  },
  {
    key: 'sessions-assessments',
    path: '/sessions/start',
    duration: 20,
    narration:
      'This is the real session workflow. Create a training or match session, add the right players, and use the queue to complete each assessment.',
    captions: [
      ['Create a real training or match session from this page.', 0, 7],
      ['Add the players who should be assessed in that session.', 7, 14],
      ['Open the queue and complete each assessment from the live form.', 14, 20],
    ],
    points: [
      [83, 375],
      [450, 285],
      [760, 420],
      [1040, 505],
    ],
  },
  {
    key: 'assessment-fields',
    path: '/form-builder',
    duration: 17,
    narration:
      'This is the real Assessment Fields page. Use it to control the fields coaches complete before they start a new assessment session.',
    captions: [
      ['Open Assessment Fields to control the form coaches complete.', 0, 6],
      ['Add, reorder, or remove fields for your club workflow.', 6, 12],
      ['Review the form before new assessment sessions begin.', 12, 17],
    ],
    points: [
      [92, 418],
      [420, 315],
      [780, 390],
      [1030, 498],
    ],
  },
  {
    key: 'parent-email',
    path: '/parent-email-templates',
    duration: 18,
    narration:
      'This is the real Email Templates page. Create template text here, then use player profiles or the assessment flow to send reports to parents.',
    captions: [
      ['Use Email Templates to prepare parent report wording.', 0, 6],
      ['Confirm player contact details before sending reports.', 6, 12],
      ['Review delivery from the email queue where your plan allows it.', 12, 18],
    ],
    points: [
      [92, 470],
      [448, 305],
      [790, 408],
      [1080, 508],
    ],
  },
  {
    key: 'billing',
    path: '/billing',
    duration: 16,
    narration:
      'This is the real Billing page. Review the current plan, compare limits, and only start checkout when the club is ready to upgrade.',
    captions: [
      ['Open Billing to review the current plan and limits.', 0, 5],
      ['Compare usage with the available upgrade options.', 5, 11],
      ['Start checkout only when the club is ready to upgrade.', 11, 16],
    ],
    points: [
      [82, 520],
      [440, 295],
      [790, 425],
      [1050, 505],
    ],
  },
]

function wait(ms) {
  return new Promise((resolveWait) => {
    setTimeout(resolveWait, ms)
  })
}

function formatAssTime(seconds) {
  const totalCentiseconds = Math.round(seconds * 100)
  const centiseconds = totalCentiseconds % 100
  const totalSeconds = Math.floor(totalCentiseconds / 100)
  const displaySeconds = totalSeconds % 60
  const totalMinutes = Math.floor(totalSeconds / 60)
  const minutes = totalMinutes % 60
  const hours = Math.floor(totalMinutes / 60)

  return `${hours}:${String(minutes).padStart(2, '0')}:${String(displaySeconds).padStart(2, '0')}.${String(centiseconds).padStart(2, '0')}`
}

function escapeAssText(value) {
  return String(value).replace(/[{}]/g, '').replace(/\n/g, '\\N')
}

function renderAssSubtitles(captions) {
  const events = captions
    .map(([text, start, end]) => `Dialogue: 0,${formatAssTime(start)},${formatAssTime(end)},Caption,,0,0,0,,${escapeAssText(text)}`)
    .join('\n')

  return `[Script Info]
ScriptType: v4.00+
PlayResX: ${captureWidth}
PlayResY: ${outputHeight}

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Caption,Arial,31,&H00FFFFFF,&H00FFFFFF,&H00020617,&H00020617,-1,0,0,0,100,100,0,0,1,2,0,2,72,72,36,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
${events}
`
}

async function createDemoStorageState(browser, storageStatePath) {
  const context = await browser.newContext({ viewport: { width: captureWidth, height: captureHeight } })
  await context.addInitScript(() => {
    window.sessionStorage.setItem('player-feedback-demo-role', 'admin')
  })

  const page = await context.newPage()
  await page.goto(`${baseUrl}/sign-in`, { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: /^Open demo account$/i }).click()
  await page.waitForLoadState('networkidle')
  await page.waitForTimeout(3000)
  await chooseFirstTeam(page)
  await page.context().storageState({ path: storageStatePath })
  await context.close()
}

async function chooseFirstTeam(page) {
  const openButtons = page.getByRole('button', { name: /^Open$/ })
  if (await openButtons.count()) {
    await openButtons.first().click()
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(1000)
  }
}

async function preparePage(page, guide) {
  await page.goto(`${baseUrl}${guide.path}`, { waitUntil: 'networkidle' })
  await chooseFirstTeam(page)
  await page.waitForTimeout(1500)
  await page.addStyleTag({
    content: `
      html, body { width: ${captureWidth}px !important; height: ${captureHeight}px !important; overflow: hidden !important; }
      #root { height: ${captureHeight}px !important; overflow: hidden !important; }
      #codex-onboarding-cursor {
        position: fixed;
        z-index: 2147483647;
        top: 0;
        left: 0;
        width: 30px;
        height: 30px;
        pointer-events: none;
        filter: drop-shadow(0 7px 9px rgba(0, 0, 0, 0.35));
      }
      #codex-onboarding-pulse {
        position: fixed;
        z-index: 2147483645;
        width: 72px;
        height: 72px;
        margin: -22px 0 0 -22px;
        border: 4px solid rgba(34, 197, 94, 0.95);
        border-radius: 999px;
        opacity: 0;
        pointer-events: none;
      }
      #codex-onboarding-pulse.codex-show {
        animation: codexClickPulse 700ms ease-out;
      }
      @keyframes codexClickPulse {
        0% { opacity: 1; transform: scale(0.35); }
        100% { opacity: 0; transform: scale(1.25); }
      }
    `,
  })
  await page.evaluate(() => {
    const cursor = document.createElement('div')
    cursor.id = 'codex-onboarding-cursor'
    cursor.innerHTML = '<svg viewBox="0 0 32 32" width="32" height="32" aria-hidden="true"><path d="M6 3l19 14-9 2-5 8z" fill="#ffffff" stroke="#0f172a" stroke-width="2" /></svg>'
    document.body.append(cursor)

    const pulse = document.createElement('div')
    pulse.id = 'codex-onboarding-pulse'
    document.body.append(pulse)

    window.__codexOnboarding = {
      setCursor(x, y) {
        cursor.style.transform = `translate(${x}px, ${y}px)`
      },
      pulse(x, y) {
        pulse.style.left = `${x}px`
        pulse.style.top = `${y}px`
        pulse.classList.remove('codex-show')
        void pulse.offsetWidth
        pulse.classList.add('codex-show')
      },
    }
  })
}

async function animateGuide(page, guide) {
  const points = guide.points
  const durationMs = guide.duration * 1000
  const stepMs = 80
  const startedAt = Date.now()
  const clickTimes = new Set([0.24, 0.52, 0.78])

  while (Date.now() - startedAt < durationMs) {
    const elapsedMs = Date.now() - startedAt
    const progress = Math.min(elapsedMs / durationMs, 1)
    const scaled = progress * (points.length - 1)
    const index = Math.min(Math.floor(scaled), points.length - 2)
    const local = scaled - index
    const eased = local < 0.5 ? 2 * local * local : 1 - ((-2 * local + 2) ** 2) / 2
    const current = points[index]
    const next = points[index + 1]
    const x = current[0] + (next[0] - current[0]) * eased
    const y = current[1] + (next[1] - current[1]) * eased
    await page.evaluate(
      ({ xValue, yValue }) => {
        window.__codexOnboarding.setCursor(xValue, yValue)
      },
      { xValue: x, yValue: y },
    )

    for (const clickTime of [...clickTimes]) {
      if (progress >= clickTime) {
        clickTimes.delete(clickTime)
        await page.mouse.click(x, y)
        await page.evaluate(({ xValue, yValue }) => window.__codexOnboarding.pulse(xValue, yValue), { xValue: x, yValue: y })
      }
    }

    await wait(stepMs)
  }
}

async function synthesizeSpeechWithElevenLabs(guide, audioPath) {
  const apiKey = process.env.ELEVENLABS_API_KEY
  const voiceId = process.env.ELEVENLABS_VOICE_ID

  if (!apiKey || !voiceId) {
    return false
  }

  const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'xi-api-key': apiKey,
    },
    body: JSON.stringify({
      text: guide.narration,
      model_id: process.env.ELEVENLABS_MODEL_ID || 'eleven_multilingual_v2',
      voice_settings: {
        stability: Number(process.env.ELEVENLABS_STABILITY ?? 0.45),
        similarity_boost: Number(process.env.ELEVENLABS_SIMILARITY_BOOST ?? 0.8),
        style: Number(process.env.ELEVENLABS_STYLE ?? 0.2),
        use_speaker_boost: process.env.ELEVENLABS_SPEAKER_BOOST !== 'false',
      },
    }),
  })

  if (!response.ok) {
    const errorText = await response.text().catch(() => '')
    throw new Error(`ElevenLabs TTS failed with ${response.status}: ${errorText}`)
  }

  const audio = Buffer.from(await response.arrayBuffer())
  await writeFile(audioPath, audio)
  return true
}

async function synthesizeSpeechWithEdgeTts(guide, audioPath) {
  await execFileAsync(
    'python',
    [
      '-m',
      'edge_tts',
      '--voice',
      process.env.ONBOARDING_TTS_VOICE || 'en-GB-RyanNeural',
      '--text',
      guide.narration,
      '--write-media',
      audioPath,
    ],
    {
      cwd: rootDir,
      windowsHide: true,
      maxBuffer: 1024 * 1024 * 20,
    },
  )
}

async function synthesizeSpeech(guide, audioPath) {
  if (await synthesizeSpeechWithElevenLabs(guide, audioPath)) {
    return
  }

  await synthesizeSpeechWithEdgeTts(guide, audioPath)
}

async function recordGuide(browser, storageStatePath, guide) {
  const guideDir = resolve(tempDir, guide.key)
  await mkdir(guideDir, { recursive: true })
  const context = await browser.newContext({
    storageState: storageStatePath,
    viewport: { width: captureWidth, height: captureHeight },
    recordVideo: {
      dir: guideDir,
      size: { width: captureWidth, height: captureHeight },
    },
  })
  await context.addInitScript(() => {
    window.sessionStorage.setItem('player-feedback-demo-role', 'admin')
  })

  const page = await context.newPage()
  await preparePage(page, guide)
  const video = page.video()
  await animateGuide(page, guide)
  await page.close()
  await context.close()
  return video.path()
}

async function muxVideo({ rawVideoPath, audioPath, outputPath, duration, guide }) {
  const subtitlePath = resolve(tempDir, `${outputPath.split(/[\\/]/).pop()}.ass`)
  await writeFile(subtitlePath, renderAssSubtitles(guide.captions))
  const subtitleFilterPath = subtitlePath.replace(/\\/g, '/').replace(/:/g, '\\:')

  await execFileAsync(
    ffmpegPath,
    [
      '-y',
      '-i',
      rawVideoPath,
      '-i',
      audioPath,
      '-t',
      String(duration),
      '-map',
      '0:v:0',
      '-map',
      '1:a:0',
      '-vf',
      `pad=${captureWidth}:${outputHeight}:0:0:color=0x020617,ass='${subtitleFilterPath}'`,
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
      '-b:a',
      '128k',
      '-movflags',
      '+faststart',
      outputPath,
    ],
    {
      cwd: rootDir,
      windowsHide: true,
      maxBuffer: 1024 * 1024 * 20,
    },
  )
}

async function generate() {
  await loadLocalEnv()
  await mkdir(outputDir, { recursive: true })
  await rm(tempDir, { recursive: true, force: true })
  await mkdir(tempDir, { recursive: true })

  const storageStatePath = resolve(tempDir, 'demo-storage-state.json')
  const browser = await chromium.launch()

  try {
    console.log('Logging into demo workspace')
    await createDemoStorageState(browser, storageStatePath)

    for (const guide of guides) {
      const audioPath = resolve(tempDir, `${guide.key}.mp3`)
      const outputPath = resolve(outputDir, `${guide.key}.mp4`)

      console.log(`Generating ${guide.key} from real UI`)
      const rawVideoPath = await recordGuide(browser, storageStatePath, guide)
      await synthesizeSpeech(guide, audioPath)
      await muxVideo({
        rawVideoPath,
        audioPath,
        outputPath,
        duration: guide.duration,
        guide,
      })
    }
  } finally {
    await browser.close()
  }
}

generate().catch((error) => {
  console.error(error)
  process.exit(1)
})
