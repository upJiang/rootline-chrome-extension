import { mkdir } from "node:fs/promises"
import { resolve } from "node:path"
import sharp from "sharp"

const outputDirectory = resolve(import.meta.dirname, "../public/icon")
await mkdir(outputDirectory, { recursive: true })

for (const size of [16, 32, 48, 128]) {
  const radius = Math.max(3, Math.round(size * 0.18))
  const strokeWidth = Math.max(2, Math.round(size * 0.09))
  const inset = Math.round(size * 0.2)
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
      <rect width="${size}" height="${size}" rx="${radius}" fill="#171b1a"/>
      <path d="M ${inset} ${size - inset} V ${inset} H ${Math.round(size * 0.55)} C ${Math.round(size * 0.76)} ${inset}, ${Math.round(size * 0.78)} ${Math.round(size * 0.48)}, ${Math.round(size * 0.57)} ${Math.round(size * 0.5)} H ${inset} M ${Math.round(size * 0.52)} ${Math.round(size * 0.5)} L ${size - inset} ${size - inset}" fill="none" stroke="#4ade80" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`
  await sharp(Buffer.from(svg)).png().toFile(resolve(outputDirectory, `${size}.png`))
}
