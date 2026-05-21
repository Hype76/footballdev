const screenshotSets = [
  {
    label: 'Coach iOS',
    folder: 'coach-ios-final',
    files: [
      'coach-ios-01-login.png',
      'coach-ios-02-home.png',
      'coach-ios-03-matchday.png',
      'coach-ios-04-goal-details.png',
      'coach-ios-05-players.png',
      'coach-ios-06-assessment.png',
      'coach-ios-07-settings.png',
    ],
  },
  {
    label: 'Coach Android',
    folder: 'coach-android-final',
    files: [
      'coach-android-01-login.png',
      'coach-android-02-home.png',
      'coach-android-03-matchday.png',
      'coach-android-04-goal-details.png',
      'coach-android-05-players.png',
      'coach-android-06-assessment.png',
      'coach-android-07-settings.png',
    ],
  },
  {
    label: 'Parents iOS',
    folder: 'parents-ios-final',
    files: [
      'parents-ios-01-login.png',
      'parents-ios-02-home.png',
      'parents-ios-03-matchday.png',
      'parents-ios-04-messages.png',
      'parents-ios-05-polls.png',
      'parents-ios-06-child-switcher.png',
      'parents-ios-07-settings.png',
    ],
  },
  {
    label: 'Parents Android',
    folder: 'parents-android-final',
    files: [
      'parents-android-01-login.png',
      'parents-android-02-home.png',
      'parents-android-03-matchday.png',
      'parents-android-04-messages.png',
      'parents-android-05-polls.png',
      'parents-android-06-child-switcher.png',
      'parents-android-07-settings.png',
    ],
  },
]

console.log('Football Player Mobile Screenshot Preflight')
console.log('Status: local checklist only')
console.log('This command does not call Apple, Google, EAS, Netlify, Supabase, or any live service.')
console.log('')
console.log('Screenshot source rules:')
console.log('- Capture from real store builds, TestFlight builds, or Google internal builds.')
console.log('- Do not use Expo Go, web export, browser screenshots, debug overlays, or emulator controls for final store uploads.')
console.log('- Use test database data only.')
console.log('- Do not show real child, parent, coach, player, club, email, phone, or address details.')
console.log('- Keep billing, checkout, subscription, Stripe, and bulk email screens out of screenshots.')
console.log('- Record final screenshot folder paths only under apps/mobile-release-evidence/.')
console.log('')
console.log('Final upload folders and file names:')

screenshotSets.forEach((set) => {
  console.log(`- ${set.label}: ${set.folder}`)
  set.files.forEach((file) => {
    console.log(`  ${file}`)
  })
})

console.log('')
console.log('Store limits:')
console.log('- Apple: PNG or JPEG, portrait, under 10 MB.')
console.log('- Google Play: PNG or JPEG, portrait, each side between 320 px and 3840 px.')
