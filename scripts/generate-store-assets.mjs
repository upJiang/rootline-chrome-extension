import { copyFile, mkdir } from "node:fs/promises"
import { resolve } from "node:path"
import sharp from "sharp"

const projectRoot = resolve(import.meta.dirname, "..")
const inputRoot = process.env.ROOTLINE_STORE_SCREENSHOT_INPUT ?? "/tmp"
const outputRoot = resolve(projectRoot, "store-assets")
const screenshotRoot = resolve(outputRoot, "screenshots")
const promoRoot = resolve(outputRoot, "promo")

await Promise.all([
  mkdir(screenshotRoot, { recursive: true }),
  mkdir(promoRoot, { recursive: true }),
])

function textSvg({ width, height, content }) {
  return Buffer.from(`
    <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
      <style>
        .sans { font-family: Arial, "PingFang SC", "Microsoft YaHei", sans-serif; }
        .mono { font-family: "SFMono-Regular", Consolas, monospace; }
      </style>
      ${content}
    </svg>
  `)
}

async function exactScreenshot(inputName, outputName) {
  const input = resolve(inputRoot, inputName)
  const image = sharp(input)
  const metadata = await image.metadata()
  if (metadata.width === 1280 && metadata.height === 800) {
    await image.png({ compressionLevel: 9 }).toFile(resolve(screenshotRoot, outputName))
    return
  }

  await image
    .resize({ width: 1280, height: 800, fit: "contain", background: "#f5f8f6" })
    .flatten({ background: "#f5f8f6" })
    .png({ compressionLevel: 9 })
    .toFile(resolve(screenshotRoot, outputName))
}

async function popupScreenshot() {
  const popup = await sharp(resolve(inputRoot, "rootline-popup-supported.png"))
    .resize({ width: 380, height: 680, fit: "contain", background: "#ffffff" })
    .png()
    .toBuffer()
  const icon = await sharp(resolve(projectRoot, "public/icon/128.png")).resize(96, 96).png().toBuffer()
  const copy = textSvg({
    width: 1280,
    height: 800,
    content: `
      <rect width="1280" height="800" fill="#eef3f0"/>
      <rect x="70" y="70" width="690" height="660" rx="8" fill="#ffffff" stroke="#d7ded9"/>
      <text x="96" y="228" class="sans" font-size="54" font-weight="700" fill="#101713">从当前页面开始采集</text>
      <text x="96" y="282" class="sans" font-size="24" fill="#4f5d55">复现问题、标注元素，并把浏览器现场保存到本机。</text>
      <g class="sans" font-size="23" fill="#1d2a23">
        <circle cx="111" cy="372" r="14" fill="#d8f7de"/><path d="M104 372l5 5 10-12" fill="none" stroke="#15803d" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
        <text x="142" y="380">按需采集 DOM、样式、控制台和网络</text>
        <circle cx="111" cy="434" r="14" fill="#d8f7de"/><path d="M104 434l5 5 10-12" fill="none" stroke="#15803d" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
        <text x="142" y="442">支持标注截图与可选整屏录制</text>
        <circle cx="111" cy="496" r="14" fill="#d8f7de"/><path d="M104 496l5 5 10-12" fill="none" stroke="#15803d" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
        <text x="142" y="504">报告只保存到浏览器下载目录</text>
      </g>
      <text x="96" y="632" class="mono" font-size="18" fill="#66736c">ROOTLINE · LOCAL-FIRST BROWSER EVIDENCE</text>
      <rect x="795" y="44" width="420" height="712" rx="12" fill="#d9e1dc" opacity="0.65"/>
      <rect x="785" y="34" width="420" height="712" rx="12" fill="#ffffff" stroke="#cbd5cf"/>
    `,
  })

  await sharp(copy)
    .composite([
      { input: icon, left: 96, top: 96 },
      { input: popup, left: 805, top: 50 },
    ])
    .png({ compressionLevel: 9 })
    .toFile(resolve(screenshotRoot, "01-start-capture.png"))
}

async function promoTiles() {
  const icon128 = resolve(projectRoot, "public/icon/128.png")
  const smallIcon = await sharp(icon128).resize(88, 88).png().toBuffer()
  const smallBase = textSvg({
    width: 440,
    height: 280,
    content: `
      <rect width="440" height="280" fill="#101713"/>
      <text x="220" y="178" text-anchor="middle" class="sans" font-size="36" font-weight="700" fill="#ffffff">Rootline</text>
      <text x="220" y="214" text-anchor="middle" class="sans" font-size="17" fill="#b9c7bf">网页问题采集与本地证据导出</text>
    `,
  })
  await sharp(smallBase)
    .composite([{ input: smallIcon, left: 176, top: 42 }])
    .png({ compressionLevel: 9 })
    .toFile(resolve(promoRoot, "small-promo-tile-440x280.png"))

  const marqueeIcon = await sharp(icon128).resize(112, 112).png().toBuffer()
  const capture = await sharp(resolve(screenshotRoot, "03-review-evidence.png"))
    .resize({ width: 660, height: 412, fit: "cover", position: "top" })
    .png()
    .toBuffer()
  const marqueeBase = textSvg({
    width: 1400,
    height: 560,
    content: `
      <rect width="1400" height="560" fill="#101713"/>
      <rect x="692" y="56" width="668" height="420" rx="8" fill="#253029" stroke="#405047"/>
      <text x="92" y="252" class="sans" font-size="64" font-weight="700" fill="#ffffff">Rootline</text>
      <text x="92" y="316" class="sans" font-size="30" fill="#d4ded8">网页问题采集与本地证据导出</text>
      <text x="92" y="374" class="sans" font-size="21" fill="#9fb0a6">截图 · DOM · 控制台 · 网络 · 可选录屏</text>
      <text x="92" y="430" class="sans" font-size="18" fill="#58dc76">仅支持本地保存，不上传云端</text>
    `,
  })
  await sharp(marqueeBase)
    .composite([
      { input: marqueeIcon, left: 92, top: 82 },
      { input: capture, left: 696, top: 60 },
    ])
    .png({ compressionLevel: 9 })
    .toFile(resolve(promoRoot, "marquee-promo-tile-1400x560.png"))
}

await popupScreenshot()
await exactScreenshot("rootline-annotation-editor.png", "02-annotate-problem.png")
await exactScreenshot("rootline-capture-1280.png", "03-review-evidence.png")
await exactScreenshot("rootline-ai-context-1280.png", "04-copy-ai-context.png")
await exactScreenshot("rootline-history-1280.png", "05-capture-history.png")
await promoTiles()
await copyFile(resolve(projectRoot, "public/icon/128.png"), resolve(outputRoot, "icon-128.png"))

console.log(`Rootline store assets generated in ${outputRoot}`)
