import fs from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'

// Keep source images for documents, email clients and future lossless conversions.
const roots = ['public/marketing-v70/assets', 'src/assets']
const walk = async directory => (await Promise.all((await fs.readdir(directory, { withFileTypes: true })).map(entry => {
  const file = path.join(directory, entry.name)
  return entry.isDirectory() ? walk(file) : file
}))).flat()
const images = (await Promise.all(roots.map(walk))).flat().filter(file => /\.(png|jpe?g)$/i.test(file))
images.push('public/formation-shirt-white.png', 'public/formation-shirt-gold.png')
const existingOptimisations = new Set(['src/assets/football-player-logo.png', 'src/assets/landing-hero-football-club.png'])
let before = 0, after = 0, converted = 0
for (const file of images) {
  if (existingOptimisations.has(file.replaceAll('\\', '/'))) continue
  const photo = /\.jpe?g$/i.test(file)
  const pipeline = sharp(file).rotate()
  if (photo) pipeline.resize({ width: 1920, withoutEnlargement: true })
  const target = file.startsWith('src')
    ? path.join('public/marketing-v70/assets', 'legacy-' + path.basename(file).replace(/\.(png|jpe?g)$/i, '.webp'))
    : file.startsWith('public/formation-shirt-')
      ? path.join('public/marketing-v70/assets', path.basename(file).replace('.png', '.webp'))
      : file.replace(/\.(png|jpe?g)$/i, '.webp')
  await pipeline.webp(photo ? { quality: 84, effort: 6 } : { lossless: true, effort: 6 }).toFile(target)
  before += (await fs.stat(file)).size
  after += (await fs.stat(target)).size
  converted++
  if (file.startsWith(path.join('public', 'marketing-v70')) && photo && !file.includes('tutorials')) {
    await sharp(file).rotate().resize({ width: 768, withoutEnlargement: true }).webp({ quality: 84, effort: 6 }).toFile(target.replace('.webp', '-768.webp'))
  }
}
console.log(JSON.stringify({ images: converted, before, after, reductionPercent: Math.round((1 - after / before) * 100) }))
