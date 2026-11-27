// Lager PNG-ikoner fra samme motiv som public/favicon.svg.
// Kjøres for hånd når ikonet endres: node scripts/generate-icons.mjs
// Bruker sharp (følger med @cloudflare/vite-plugin via miniflare).
import { writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const pub = (name) => fileURLToPath(new URL(`../public/${name}`, import.meta.url))

const glyph = `<g fill="none" stroke="#e8b864" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"><path d="M32 54V22"/><path d="M32 30c-6-1-10-5-10-11 6 1 10 5 10 11z"/><path d="M32 30c6-1 10-5 10-11-6 1-10 5-10 11z"/><path d="M32 42c-6-1-10-5-10-11 6 1 10 5 10 11z"/><path d="M32 42c6-1 10-5 10-11-6 1-10 5-10 11z"/><path d="M32 22c0-4 0-7 0-10"/></g>`

// Avrundet: vises som det er (Android «any», nettleserfaner)
const rounded = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#2f5240"/>${glyph}</svg>`
// Firkantet med motivet krympet inn mot midten: iOS og Android runder av hjørnene selv
const fullBleed = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="#2f5240"/><g transform="translate(32 33) scale(0.8) translate(-32 -33)">${glyph}</g></svg>`

const icons = [
  ['apple-touch-icon.png', fullBleed, 180],
  ['icon-192.png', rounded, 192],
  ['icon-512.png', rounded, 512],
  ['icon-maskable-512.png', fullBleed, 512],
]

for (const [name, svg, size] of icons) {
  const png = await sharp(Buffer.from(svg), { density: (72 * size) / 64 }).resize(size, size).png().toBuffer()
  await writeFile(pub(name), png)
  console.log(`${name} (${size}×${size})`)
}
