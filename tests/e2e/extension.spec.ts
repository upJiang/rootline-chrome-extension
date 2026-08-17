import { chromium, expect, test, type BrowserContext, type Page, type Worker } from "@playwright/test"
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { cp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import sharp from "sharp"

let context: BrowserContext
let extensionId = ""
let extensionPath = ""
let temporaryRoot = ""
let productionManifest: Record<string, unknown>

function resolveChromeExecutable(): string {
  const configuredPath = process.env.ROOTLINE_CHROME_PATH
  if (configuredPath) {
    if (!existsSync(configuredPath)) {
      throw new Error(`ROOTLINE_CHROME_PATH does not exist: ${configuredPath}`)
    }
    return configuredPath
  }

  const bundledPath = chromium.executablePath()
  if (existsSync(bundledPath)) return bundledPath

  const platformCandidates: Record<NodeJS.Platform, string[]> = {
    aix: [],
    android: [],
    darwin: [
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
      "/Applications/Chromium.app/Contents/MacOS/Chromium",
    ],
    freebsd: [],
    haiku: [],
    linux: [
      "/usr/bin/google-chrome",
      "/usr/bin/google-chrome-stable",
      "/usr/bin/chromium",
      "/usr/bin/chromium-browser",
    ],
    openbsd: [],
    sunos: [],
    win32: [
      join(process.env.PROGRAMFILES ?? "", "Google", "Chrome", "Application", "chrome.exe"),
      join(process.env["PROGRAMFILES(X86)"] ?? "", "Google", "Chrome", "Application", "chrome.exe"),
      join(process.env.LOCALAPPDATA ?? "", "Google", "Chrome", "Application", "chrome.exe"),
    ],
    cygwin: [],
    netbsd: [],
  }
  const systemChrome = platformCandidates[process.platform].find((candidate) => candidate && existsSync(candidate))
  if (systemChrome) return systemChrome

  throw new Error(
    "No Chrome/Chromium executable was found. Run `pnpm exec playwright install chromium` "
      + "or set ROOTLINE_CHROME_PATH to a Chrome 120+ executable.",
  )
}

async function extensionWorker(): Promise<Worker> {
  const current = context.serviceWorkers().find((worker) => new URL(worker.url()).host === extensionId)
  return current ?? context.waitForEvent("serviceworker", {
    timeout: 15_000,
    predicate: (worker) => new URL(worker.url()).host === extensionId,
  })
}

async function loadExtension(): Promise<void> {
  const browser = context.browser()
  if (!browser) throw new Error("Persistent Chromium browser is unavailable")
  const session = await browser.newBrowserCDPSession()
  try {
    const loaded = await session.send("Extensions.loadUnpacked", { path: extensionPath })
    if (extensionId && loaded.id !== extensionId) {
      throw new Error(`Extension ID changed after reload: ${extensionId} -> ${loaded.id}`)
    }
    extensionId = loaded.id
  } finally {
    await session.detach()
  }
}

async function terminateExtensionWorker(): Promise<void> {
  const browser = context.browser()
  if (!browser) throw new Error("Persistent Chromium browser is unavailable")
  const session = await browser.newBrowserCDPSession()
  try {
    const { targetInfos } = await session.send("Target.getTargets")
    const target = targetInfos.find((item) => item.type === "service_worker" && item.url.includes(extensionId))
    if (!target) throw new Error("Rootline service worker target was not found")
    await session.send("Target.closeTarget", { targetId: target.targetId })
  } finally {
    await session.detach()
  }
}

async function openExtensionTab(path: string, active = false): Promise<Page> {
  const url = `chrome-extension://${extensionId}/${path}`
  const existingPages = new Set(context.pages())
  const browser = context.browser()
  if (!browser) throw new Error("Persistent Chromium browser is unavailable")
  const session = await browser.newBrowserCDPSession()
  try {
    await session.send("Target.createTarget", { url, background: !active })
  } finally {
    await session.detach()
  }
  await expect.poll(() => context.pages().some((page) => !existingPages.has(page) && page.url() === url), {
    timeout: 10_000,
  }).toBe(true)
  const page = context.pages().find((candidate) => !existingPages.has(candidate) && candidate.url() === url)
  if (!page) throw new Error(`Extension page unavailable: ${url}`)
  await page.waitForLoadState("domcontentloaded")
  return page
}

async function waitForCapturePage(previousPages: Set<Page>): Promise<Page> {
  await expect.poll(() => context.pages().find((page) => !previousPages.has(page) && page.url().includes(`chrome-extension://${extensionId}/capture.html`))?.url() ?? "", {
    timeout: 15_000,
  }).toContain("record=")
  const page = context.pages().find((candidate) => !previousPages.has(candidate) && candidate.url().includes(`chrome-extension://${extensionId}/capture.html`))
  if (!page) throw new Error("Capture page was not opened")
  await page.waitForLoadState("domcontentloaded")
  await expect(page.getByRole("heading", { name: "运行现场" })).toBeVisible()
  return page
}

async function startSession(fixturePage: Page): Promise<void> {
  await fixturePage.bringToFront()
  const popup = await openExtensionTab("popup.html")
  await expect(popup.getByRole("button", { name: "开始标注" })).toBeEnabled()
  await popup.getByRole("button", { name: "开始标注" }).click()
  await expect.poll(() => popup.isClosed()).toBe(true)
  await expect(fixturePage.locator("#rootline-runtime-overlay")).toBeAttached()
}

async function capturedEvidence(extensionPage: Page): Promise<{
  hasConsoleError: boolean
  hasRejection: boolean
  hasFetch500: boolean
  hasXhr: boolean
}> {
  return extensionPage.evaluate(async () => {
    const active = await chrome.runtime.sendMessage({ type: "GET_ACTIVE_STATE" })
    const sessionId = active?.data?.session?.id
    if (!sessionId) return { hasConsoleError: false, hasRejection: false, hasFetch500: false, hasXhr: false }
    const response = await chrome.runtime.sendMessage({ type: "GET_SESSION", sessionId })
    const session = response?.data
    return {
      hasConsoleError: Boolean(session?.console?.some((item: { message?: string }) => item.message?.includes("Fixture save failed"))),
      hasRejection: Boolean(session?.console?.some((item: { message?: string }) => item.message?.includes("Unhandled rejection"))),
      hasFetch500: Boolean(session?.network?.some((item: { status?: number }) => item.status === 500)),
      hasXhr: Boolean(session?.network?.some((item: { type?: string }) => item.type === "xhr")),
    }
  })
}

async function annotateElement(
  page: Page,
  selector: string,
  actualResult: string,
  expectedResult: string,
  verifyLayout = false,
): Promise<void> {
  const overlay = page.locator("#rootline-runtime-overlay")
  const select = overlay.locator("button[data-select]")
  const existingTargetCount = await overlay.locator("button.target-index").count()
  if (await select.getAttribute("data-active") !== "true") await select.click()
  if (verifyLayout) {
    await page.locator(selector).hover()
    const inspector = overlay.locator("[data-hover-label]")
    await expect(inspector).toBeVisible()
    await expect(inspector).toContainText(/\d+ x \d+px/)
    await expect(inspector).toContainText("font ")
    await expect(inspector).toContainText("display ")
    await expect(inspector).toContainText("p ")
    await expect(inspector).toContainText("m ")

    await page.keyboard.press("a")
    await expect(select).toHaveAttribute("data-active", "false")
    await page.keyboard.press("a")
    await expect(select).toHaveAttribute("data-active", "true")

    const elementMode = overlay.locator('button[data-mode="element"]')
    const spacingMode = overlay.locator('button[data-mode="spacing"]')
    await expect(elementMode).toHaveAttribute("data-active", "")
    await spacingMode.click()
    await expect(spacingMode).toHaveAttribute("data-active", "")
    await page.locator(selector).hover()
    await expect(overlay.locator("[data-highlight]")).toHaveAttribute("data-kind", /text-line|spacing/)
    await elementMode.click()
  }
  await page.locator(selector).click()
  const pendingToolbar = overlay.locator("[data-pending-toolbar]")
  await expect(pendingToolbar).toBeVisible()
  await expect(overlay.locator("[data-editor]")).toBeHidden()
  if (verifyLayout) {
    const activeBackground = await select.evaluate((button) => getComputedStyle(button).backgroundColor)
    await select.hover()
    expect(await select.evaluate((button) => getComputedStyle(button).backgroundColor)).toBe(activeBackground)
    expect(activeBackground).not.toBe("rgb(243, 245, 244)")

    const initialRect = await overlay.locator("[data-highlight]").evaluate((highlight) => {
      const rect = highlight.getBoundingClientRect()
      return { width: rect.width, height: rect.height }
    })
    await pendingToolbar.locator("button[data-select-parent]").click()
    const parentRect = await overlay.locator("[data-highlight]").evaluate((highlight) => {
      const rect = highlight.getBoundingClientRect()
      return { width: rect.width, height: rect.height }
    })
    expect(parentRect.width * parentRect.height).toBeGreaterThanOrEqual(initialRect.width * initialRect.height)
    await pendingToolbar.locator("button[data-reselect-target]").click()
    await expect(pendingToolbar).toBeHidden()
    await page.locator(selector).click()
    await expect(pendingToolbar).toBeVisible()

    const originalViewport = page.viewportSize() ?? { width: 1280, height: 720 }
    for (const width of [320, 375, 414, 768]) {
      await page.setViewportSize({ width, height: 820 })
      const layout = await overlay.evaluate((host) => {
        const shadow = host.shadowRoot
        const panel = shadow?.querySelector<HTMLElement>("[data-pending-toolbar]")
        const controls = Array.from(shadow?.querySelectorAll<HTMLElement>("[data-pending-toolbar] button") ?? [])
          .filter((element) => !element.hidden)
          .map((element) => {
            const rect = element.getBoundingClientRect()
            return { width: rect.width, height: rect.height }
          })
        const rect = panel?.getBoundingClientRect()
        return {
          panelLeft: rect?.left ?? -1,
          panelRight: rect?.right ?? Number.POSITIVE_INFINITY,
          viewport: window.innerWidth,
          undersized: controls.filter((control) => control.width < 44 || control.height < 44),
        }
      })
      expect(layout.panelLeft, `${width}px pending toolbar left edge`).toBeGreaterThanOrEqual(0)
      expect(layout.panelRight, `${width}px pending toolbar right edge`).toBeLessThanOrEqual(layout.viewport)
      expect(layout.undersized, `${width}px pending toolbar controls smaller than 44px`).toEqual([])
    }
    await page.setViewportSize(originalViewport)
    if (process.env.ROOTLINE_SCREENSHOTS === "1") {
      await page.screenshot({ path: "/tmp/rootline-pending-target.png" })
    }
  }
  await pendingToolbar.locator("button[data-confirm-target]").click()
  await expect(pendingToolbar).toBeHidden()
  await expect(overlay.locator("button.target-index")).toHaveCount(existingTargetCount + 1)
  await expect(overlay.locator("[data-editor]")).toBeVisible()
  if (verifyLayout) {
    const editor = overlay.locator("[data-editor]")
    await editor.hover()
    await page.locator("h1").hover()
    await expect(editor).toBeHidden({ timeout: 3_000 })
    await overlay.locator("button.target-index").first().hover()
    await expect(editor).toBeVisible()

    const originalViewport = page.viewportSize() ?? { width: 1280, height: 720 }
    for (const width of [320, 375, 414, 768]) {
      await page.setViewportSize({ width, height: 820 })
      const layout = await overlay.evaluate((host) => {
        const shadow = host.shadowRoot
        const panel = shadow?.querySelector<HTMLElement>("[data-editor]")
        const controls = Array.from(shadow?.querySelectorAll<HTMLElement>("[data-editor] button, [data-editor] textarea") ?? [])
          .filter((element) => !element.hidden)
          .map((element) => {
            const rect = element.getBoundingClientRect()
            return { width: rect.width, height: rect.height }
          })
        const rect = panel?.getBoundingClientRect()
        return {
          panelLeft: rect?.left ?? -1,
          panelRight: rect?.right ?? Number.POSITIVE_INFINITY,
          viewport: window.innerWidth,
          undersized: controls.filter((control) => control.width < 44 || control.height < 44),
        }
      })
      expect(layout.panelLeft, `${width}px editor left edge`).toBeGreaterThanOrEqual(0)
      expect(layout.panelRight, `${width}px editor right edge`).toBeLessThanOrEqual(layout.viewport)
      expect(layout.undersized, `${width}px editor controls smaller than 44px`).toEqual([])
    }
    await page.setViewportSize(originalViewport)
    if (process.env.ROOTLINE_SCREENSHOTS === "1") {
      await page.screenshot({ path: "/tmp/rootline-annotation-editor.png" })
    }
  }
  await overlay.locator("textarea[data-actual]").fill(actualResult)
  await overlay.locator("textarea[data-expected]").fill(expectedResult)
  await overlay.locator("button[data-save-annotation]").click()
  await expect(overlay.locator("[data-editor]")).toBeHidden()
  if (verifyLayout) {
    await overlay.locator("[data-panel]").evaluate((element) => {
      Object.assign((element as HTMLElement).style, {
        left: "auto",
        right: "16px",
        top: "46%",
        transform: "translateY(-50%)",
      })
    })
  }
}

async function verifyFloatingPanel(page: Page): Promise<void> {
  const overlay = page.locator("#rootline-runtime-overlay")
  const panel = overlay.locator("[data-panel]")
  const handle = overlay.locator("[data-panel-drag-handle]")
  await expect(panel).toBeVisible()

  await expect.poll(() => overlay.getAttribute("data-panel-dimmed"), { timeout: 2_000 }).toBeNull()
  await expect.poll(() => panel.evaluate((element) => getComputedStyle(element).opacity), { timeout: 2_000 }).toBe("1")
  await panel.hover()
  await expect(overlay).not.toHaveAttribute("data-panel-dimmed")

  const panelBox = await panel.boundingBox()
  const handleBox = await handle.boundingBox()
  if (!panelBox || !handleBox) throw new Error("Runtime panel geometry is unavailable")
  expect(Math.round(panelBox.width)).toBe(346)
  for (let attempt = 0; attempt < 3 && await overlay.getAttribute("data-panel-edge") !== "left"; attempt += 1) {
    const currentHandle = await handle.boundingBox()
    if (!currentHandle) throw new Error("Runtime panel drag handle is unavailable")
    await page.mouse.move(currentHandle.x + 24, currentHandle.y + 18)
    await page.mouse.down()
    await page.mouse.move(4, Math.max(24, currentHandle.y + 48), { steps: 12 })
    await page.mouse.up()
    await page.waitForTimeout(80)
  }
  await expect(overlay).toHaveAttribute("data-panel-edge", "left")
  await page.mouse.move(Math.round(page.viewportSize()?.width ?? 1280) / 2, 24)
  await expect(overlay).toHaveAttribute("data-panel-collapsed", "", { timeout: 1_500 })

  await page.mouse.move(5, Math.max(30, panelBox.y + panelBox.height / 2))
  await expect(overlay).not.toHaveAttribute("data-panel-collapsed", "")
  await page.mouse.move(Math.round(page.viewportSize()?.width ?? 1280) / 2, 40)
  await expect.poll(() => overlay.getAttribute("data-panel-collapsed"), { timeout: 1_500 }).toBe("")

  await page.mouse.move(5, Math.max(30, panelBox.y + panelBox.height / 2))
  await expect(overlay).not.toHaveAttribute("data-panel-collapsed", "")
  await expect.poll(async () => (await panel.boundingBox())?.x ?? -1).toBeGreaterThanOrEqual(0)
  const expandedHandle = await handle.boundingBox()
  if (!expandedHandle) throw new Error("Expanded panel drag handle is unavailable")
  const viewportWidth = page.viewportSize()?.width ?? 1280
  await page.mouse.move(expandedHandle.x + 24, expandedHandle.y + 18)
  await page.mouse.down()
  await page.mouse.move(Math.round(viewportWidth / 2), expandedHandle.y + 18, { steps: 8 })
  await page.mouse.up()
  await expect(overlay).not.toHaveAttribute("data-panel-edge", /left|right/)

  for (const width of [320, 375, 414, 768]) {
    await page.setViewportSize({ width, height: 820 })
    await expect.poll(async () => {
      const rect = await panel.boundingBox()
      return rect ? rect.x + rect.width : Number.POSITIVE_INFINITY
    }).toBeLessThanOrEqual(width)
    const layout = await panel.evaluate((element) => {
      const rect = element.getBoundingClientRect()
      const controls = Array.from(element.querySelectorAll<HTMLElement>("button"))
        .filter((button) => {
          const buttonRect = button.getBoundingClientRect()
          const style = getComputedStyle(button)
          return !button.hidden && buttonRect.width > 0 && buttonRect.height > 0 && style.display !== "none" && style.visibility !== "hidden"
        })
        .map((button) => {
          const buttonRect = button.getBoundingClientRect()
          return { width: buttonRect.width, height: buttonRect.height }
        })
      return {
        left: rect.left,
        right: rect.right,
        viewport: window.innerWidth,
        undersized: controls.filter((control) => control.width < 44 || control.height < 44),
      }
    })
    expect(layout.left, `${width}px floating panel left edge`).toBeGreaterThanOrEqual(0)
    expect(layout.right, `${width}px floating panel right edge`).toBeLessThanOrEqual(layout.viewport)
    expect(layout.undersized, `${width}px floating panel controls smaller than 44px`).toEqual([])
  }
  await page.setViewportSize({ width: 1280, height: 720 })

  const restoredHandle = await handle.boundingBox()
  if (!restoredHandle) throw new Error("Restored panel drag handle is unavailable")
  await panel.evaluate((element) => {
    Object.assign((element as HTMLElement).style, {
      left: "auto",
      right: "16px",
      top: "46%",
      transform: "translateY(-50%)",
    })
  })
}

async function finishFromPage(page: Page): Promise<void> {
  const previousPages = new Set(context.pages())
  const overlay = page.locator("#rootline-runtime-overlay")
  await overlay.locator("button[data-finish]").click()
  try {
    await expect(overlay.locator("[data-complete]")).toBeVisible({ timeout: 15_000 })
  } catch (error) {
    const feedback = await overlay.locator("[data-workflow-feedback]").textContent().catch(() => null)
    const session = await (await extensionWorker()).evaluate(async () => {
      const active = await chrome.runtime.sendMessage({ type: "GET_ACTIVE_STATE" })
      const id = active?.data?.session?.id
      return id ? (await chrome.runtime.sendMessage({ type: "GET_SESSION", sessionId: id }))?.data : null
    })
    throw new Error(`采集未完成：${feedback?.trim() || "页面没有返回错误"}\n${JSON.stringify(session?.boundaries ?? [])}`, { cause: error })
  }
  expect(context.pages().filter((candidate) => !previousPages.has(candidate))).toEqual([])
}

async function openReviewFromPage(page: Page): Promise<Page> {
  const previousPages = new Set(context.pages())
  await page.locator("#rootline-runtime-overlay").locator("button[data-open-review]").click()
  return waitForCapturePage(previousPages)
}

async function exportedFiles(): Promise<{
  markdown: string
  json: string
  capture: Buffer
  directoryName: string
  directoryPath: string
  capturePath: string
}> {
  const page = await openExtensionTab("capture-history.html")
  const location = await page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("rootline-capture-history", 1)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    const records = await new Promise<Array<{ report?: { generatedAt?: string; localArtifacts?: Record<string, unknown> } }>>((resolve, reject) => {
      const request = database.transaction("records", "readonly").objectStore("records").getAll()
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    records.sort((left, right) => String(right.report?.generatedAt ?? "").localeCompare(String(left.report?.generatedAt ?? "")))
    return records[0]?.report?.localArtifacts ?? null
  }) as { directoryName: string; directoryPath: string; reportMarkdownPath: string; reportJsonPath: string; capturePath: string } | null
  await page.close()
  if (!location) throw new Error("No capture history location found")
  return {
    markdown: readFileSync(location.reportMarkdownPath, "utf8"),
    json: readFileSync(location.reportJsonPath, "utf8"),
    capture: readFileSync(location.capturePath),
    directoryName: location.directoryName,
    directoryPath: location.directoryPath,
    capturePath: location.capturePath,
  }
}

async function annotationAtExpectedPosition(capturePage: Page): Promise<boolean> {
  const imageDataUrl = await capturePage.locator(".capture-stage img").getAttribute("src", { timeout: 5_000 })
  const record = new URL(capturePage.url()).searchParams.get("record")
  if (!imageDataUrl || !record) return false
  const evidence = await capturePage.evaluate(async ({ imageUrl, recordName }) => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("rootline-capture-history", 1)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    const stored = await new Promise<{ report?: unknown }>((resolve, reject) => {
      const request = database.transaction("records", "readonly").objectStore("records").get(recordName)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    const buffer = await (await fetch(imageUrl)).arrayBuffer()
    return { report: stored.report, bytes: Array.from(new Uint8Array(buffer)) }
  }, { imageUrl: imageDataUrl, recordName: record })
  const session = evidence.report as { page: { viewport: { width: number; height: number } }; targets: Array<{ rect: { x: number; y: number } }> }
  const target = session?.targets?.[0]
  if (!target) return false
  const decoded = Buffer.from(evidence.bytes)
  const image = sharp(decoded)
  const metadata = await image.metadata()
  const width = metadata.width ?? 0
  const height = metadata.height ?? 0
  if (!width || !height) return false
  const raw = await image.ensureAlpha().raw().toBuffer()
  const scaleX = width / Math.max(session.page.viewport.width, 1)
  const scaleY = height / Math.max(session.page.viewport.height, 1)
  const expectedX = Math.round(target.rect.x * scaleX)
  const expectedY = Math.round(target.rect.y * scaleY)
  for (let y = Math.max(0, expectedY - 6); y <= Math.min(height - 1, expectedY + 10); y += 1) {
    for (let x = Math.max(0, expectedX - 6); x <= Math.min(width - 1, expectedX + 10); x += 1) {
      const offset = (y * width + x) * 4
      const red = raw[offset] ?? 0
      const green = raw[offset + 1] ?? 0
      const blue = raw[offset + 2] ?? 0
      if (green > 120 && green > red * 1.5 && green > blue * 1.4) return true
    }
  }
  return false
}

test.beforeAll(async () => {
  test.setTimeout(120_000)
  temporaryRoot = mkdtempSync(join(tmpdir(), "rootline-e2e-"))
  extensionPath = join(temporaryRoot, "extension")
  await cp(resolve(".output/chrome-mv3"), extensionPath, { recursive: true })
  const manifestPath = join(extensionPath, "manifest.json")
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Record<string, unknown>
  productionManifest = structuredClone(manifest)
  // The production manifest intentionally has no host permissions. The temporary
  // E2E copy uses all_urls so Chrome's captureVisibleTab permission is available
  // after the fixture page is refreshed; the production manifest assertion above
  // still guards the shipped permission boundary.
  manifest.host_permissions = ["<all_urls>"]
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2))

  context = await chromium.launchPersistentContext(join(temporaryRoot, "profile"), {
    acceptDownloads: true,
    downloadsPath: join(temporaryRoot, "downloads"),
    executablePath: resolveChromeExecutable(),
    headless: false,
    ignoreDefaultArgs: ["--disable-extensions"],
    args: ["--enable-unsafe-extension-debugging"],
  })
  await loadExtension()
})

test.afterAll(async () => {
  await context?.close()
  if (temporaryRoot) rmSync(temporaryRoot, { recursive: true, force: true })
})

test("production manifest keeps capture local and on demand", () => {
  expect(productionManifest.permissions).toEqual(["activeTab", "alarms", "tabs", "scripting", "storage", "offscreen", "downloads"])
  expect(productionManifest.host_permissions).toBeUndefined()
  expect(productionManifest.optional_host_permissions).toBeUndefined()
  expect(productionManifest).not.toHaveProperty("content_scripts")
})

test("popup keeps its intended width when Chrome starts from a narrow viewport", async () => {
  const popup = await openExtensionTab("popup.html")
  await popup.setViewportSize({ width: 120, height: 620 })
  const layout = await popup.evaluate(() => ({
    html: document.documentElement.getBoundingClientRect().width,
    body: document.body.getBoundingClientRect().width,
    root: document.getElementById("root")?.getBoundingClientRect().width ?? 0,
    shell: document.querySelector(".popup-shell")?.getBoundingClientRect().width ?? 0,
  }))
  expect(layout).toEqual({ html: 380, body: 380, root: 380, shell: 380 })
  if (process.env.ROOTLINE_SCREENSHOTS === "1") {
    await popup.setViewportSize({ width: 380, height: 620 })
    await popup.screenshot({ path: "/tmp/rootline-popup-380.png", fullPage: true })
  }
})

test("uses the Chrome download directory without setup", async () => {
  const fixturePage = context.pages()[0] ?? await context.newPage()
  await fixturePage.goto("http://127.0.0.1:4178/react.html")
  const popup = await openExtensionTab("popup.html")
  await expect(popup.getByRole("button", { name: "开始标注" })).toBeEnabled()
  await expect(popup.getByRole("button", { name: "录制页面" })).toBeEnabled()
  await expect(popup.getByText("文件自动保存到", { exact: true })).toHaveCount(0)
  await expect(popup.getByText("Downloads/Rootline", { exact: true })).toHaveCount(0)
  await expect(popup.getByText("最长录屏", { exact: true })).toHaveCount(0)
  await expect(popup.getByLabel("最长录屏分钟数")).toHaveCount(0)
  await expect(popup.getByRole("dialog", { name: "保存位置" })).toHaveCount(0)
  await expect(popup.getByText("目录路径（选填）")).toHaveCount(0)
  await expect(popup.getByText(/清理.*临时会话/)).toHaveCount(0)
  await expect(popup.getByText("仅支持本地保存，文件保存位置默认浏览器下载目录", { exact: true })).toBeVisible()
  if (process.env.ROOTLINE_SCREENSHOTS === "1") {
    await popup.setViewportSize({ width: 380, height: 680 })
    await popup.screenshot({ path: "/tmp/rootline-save-location.png", fullPage: true })
  }
  await popup.close()
})

test("keeps the selected source page without requiring save setup", async () => {
  const fixturePage = context.pages()[0] ?? await context.newPage()
  await fixturePage.goto("http://127.0.0.1:4178/react.html")
  const sourceTabId = await openExtensionTab("instructions.html").then(async (controller) => {
    const id = await controller.evaluate(async (fixtureUrl) => {
      const [tab] = await chrome.tabs.query({ url: fixtureUrl })
      return tab?.id ?? null
    }, fixturePage.url())
    await controller.close()
    return id
  })
  expect(sourceTabId).toBeTruthy()
  const popup = await openExtensionTab(`popup.html?sourceTabId=${sourceTabId}`)
  await expect(popup.getByText("127.0.0.1", { exact: true })).toBeVisible()
  await expect(popup.getByText("文件自动保存到", { exact: true })).toHaveCount(0)
  await expect(popup.getByText("选择文件夹", { exact: true })).toHaveCount(0)
  await expect(popup.getByText("127.0.0.1", { exact: true })).toBeVisible()
  await expect(popup.getByRole("button", { name: "开始标注" })).toBeEnabled()
  await popup.close()
})

test("captures, recovers after worker restart and page refresh, reviews, and exports offline", async () => {
  test.setTimeout(120_000)
  const fixturePage = context.pages()[0] ?? await context.newPage()
  await fixturePage.goto("http://127.0.0.1:4178/react.html")
  await startSession(fixturePage)
  await verifyFloatingPanel(fixturePage)

  const recordingControlPage = await openExtensionTab("instructions.html")
  const activeSession = await recordingControlPage.evaluate(async () => {
    const active = await chrome.runtime.sendMessage({ type: "GET_ACTIVE_STATE" })
    const session = active?.data?.session
    if (!session) return null
    const startedAt = new Date().toISOString()
    await chrome.tabs.sendMessage(session.tabId, {
      type: "ROOTLINE_RECORDING_STATE",
      recordingState: {
        resultId: "e2e-recording",
        status: "recording",
        startedAt,
        maxDurationMs: 60_000,
      },
    })
    return session.id
  })
  expect(activeSession).toBeTruthy()
  const recordingStrip = fixturePage.locator("#rootline-runtime-overlay").locator("[data-recording-strip]")
  await expect(recordingStrip).toBeVisible()
  await expect(recordingStrip.getByText("正在录制整个屏幕")).toBeVisible()
  await expect(fixturePage.locator("#rootline-runtime-overlay").locator("[data-finish]")).toHaveText("停止录屏并生成证据")
  await recordingControlPage.evaluate(async () => {
    const active = await chrome.runtime.sendMessage({ type: "GET_ACTIVE_STATE" })
    if (active?.data?.session?.tabId) await chrome.tabs.sendMessage(active.data.session.tabId, { type: "ROOTLINE_RECORDING_STATE" })
  })
  await recordingControlPage.close()
  await expect(recordingStrip).toBeHidden()

  await fixturePage.locator('[data-testid="save-button"]').evaluate((element) => {
    ;(element as HTMLButtonElement).click()
  })
  await expect(fixturePage.locator("#result")).toHaveText("请求已触发")
  await annotateElement(
    fixturePage,
    '[data-testid="save-button"]',
    "点击保存后接口返回错误，但按钮附近没有失败反馈。",
    "保存失败时显示明确错误，并保持页面可继续操作。",
    true,
  )
  await annotateElement(
    fixturePage,
    "#result",
    "结果区域只显示请求已触发，没有显示失败原因。",
    "结果区域应展示保存失败原因和可重试状态。",
  )
  const evidencePopup = await openExtensionTab("popup.html")
  await expect.poll(async () => evidencePopup.locator(".evidence-metric__value").allTextContents(), { timeout: 10_000 }).toEqual(["2", expect.any(String), expect.any(String), expect.any(String)])
  await expect.poll(() => capturedEvidence(evidencePopup), { timeout: 10_000 }).toEqual({
    hasConsoleError: true,
    hasRejection: true,
    hasFetch500: true,
    hasXhr: true,
  })
  await evidencePopup.close()

  await terminateExtensionWorker()
  await extensionWorker()
  await expect(fixturePage.locator("#rootline-runtime-overlay")).toBeAttached()
  await expect.poll(() => fixturePage.evaluate(() => window.fetch !== (window as typeof window & { __rootlineOriginalFetch?: typeof fetch }).__rootlineOriginalFetch)).toBe(true)

  await fixturePage.bringToFront()
  const resumedPopup = await openExtensionTab("popup.html")
  await expect(resumedPopup.getByRole("button", { name: "回到页面继续复现" })).toBeVisible()
  await resumedPopup.getByRole("button", { name: "回到页面继续复现" }).click()
  await expect(fixturePage.locator("#rootline-runtime-overlay")).toBeAttached()

  await fixturePage.reload()
  await expect(fixturePage.locator("#rootline-runtime-overlay")).toHaveCount(0)
  const refreshedPopup = await openExtensionTab("popup.html")
  await expect(refreshedPopup.getByRole("button", { name: "回到页面继续复现" })).toBeVisible()
  await refreshedPopup.getByRole("button", { name: "回到页面继续复现" }).click()
  await expect(fixturePage.locator("#rootline-runtime-overlay")).toBeAttached()
  await expect(fixturePage.locator("#rootline-runtime-overlay").locator("button.target-index")).toHaveCount(2)

  await finishFromPage(fixturePage)
  const completion = fixturePage.locator("#rootline-runtime-overlay")
  await expect(completion).toHaveAttribute("data-capture-hidden", "")
  await expect(completion.getByText("2 个元素", { exact: false })).toBeVisible()
  await expect(completion.getByRole("button", { name: "查看本次完整证据" })).toBeVisible()
  await expect(completion.getByRole("button", { name: "重新标注" })).toBeVisible()
  const initialExportedFiles = await exportedFiles()
  await expect(completion.locator("[data-complete-location]")).toHaveText(initialExportedFiles.directoryPath)
  await completion.locator("button[data-copy-context]").click()
  await expect(completion.getByText(/AI 上下文已复制/)).toBeVisible()
  await expect(completion.getByText(/AI 上下文已复制/)).toBeHidden({ timeout: 4_000 })

  for (const width of [320, 375, 414, 768]) {
    await fixturePage.setViewportSize({ width, height: 820 })
    const layout = await fixturePage.locator("#rootline-runtime-overlay").evaluate((host) => {
      const shadow = host.shadowRoot
      const panel = shadow?.querySelector<HTMLElement>("[data-complete]")
      const controls = Array.from(shadow?.querySelectorAll<HTMLElement>("[data-complete] button") ?? [])
        .filter((element) => !element.hidden)
        .map((element) => {
          const rect = element.getBoundingClientRect()
          return { width: rect.width, height: rect.height }
        })
      const rect = panel?.getBoundingClientRect()
      return {
        panelLeft: rect?.left ?? -1,
        panelRight: rect?.right ?? Number.POSITIVE_INFINITY,
        viewport: window.innerWidth,
        undersized: controls.filter((control) => control.width < 44 || control.height < 44),
      }
    })
    expect(layout.panelLeft, `${width}px completion left edge`).toBeGreaterThanOrEqual(0)
    expect(layout.panelRight, `${width}px completion right edge`).toBeLessThanOrEqual(layout.viewport)
    expect(layout.undersized, `${width}px completion controls smaller than 44px`).toEqual([])
  }

  await fixturePage.setViewportSize({ width: 1280, height: 900 })
  if (process.env.ROOTLINE_SCREENSHOTS === "1") {
    await fixturePage.screenshot({ path: "/tmp/rootline-completion-panel.png" })
  }
  await context.setOffline(true)
  await completion.locator("button[data-export-report]").click()
  await expect(completion.getByText(/报告已重新导出到/)).toBeVisible({ timeout: 15_000 })
  await context.setOffline(false)

  const capturePage = await openReviewFromPage(fixturePage)

  await capturePage.getByRole("tab", { name: /元素/ }).click()
  await expect(capturePage.getByText("点击保存后接口返回错误，但按钮附近没有失败反馈。")).toBeVisible()
  await capturePage.locator(".evidence-item").nth(1).locator("summary").click()
  await expect(capturePage.getByText("结果区域应展示保存失败原因和可重试状态。")).toBeVisible()
  await expect(capturePage.getByText("SaveButton > App")).toBeVisible()
  await expect(capturePage.getByText(/onClick, password/)).toBeVisible()
  await capturePage.getByRole("tab", { name: /控制台/ }).click()
  await expect(capturePage.getByText(/Fixture save failed/).first()).toBeVisible()
  await expect(capturePage.getByText(/Unhandled rejection/).first()).toBeVisible()
  await capturePage.getByRole("tab", { name: /网络/ }).click()
  await expect(capturePage.getByText("500", { exact: true }).first()).toBeVisible()
  await expect(capturePage.getByText(/api\/xhr/).first()).toBeVisible()
  const visibleText = await capturePage.locator("body").innerText()
  for (const secret of ["console-secret", "console-password", "rejection-secret", "query-secret", "auth-secret", "request-secret", "response-secret", "xhr-auth-secret", "xhr-request-secret", "xhr-response-secret"]) {
    expect(visibleText).not.toContain(secret)
  }
  expect(await annotationAtExpectedPosition(capturePage)).toBe(true)

  for (const width of [320, 375, 414, 768]) {
    await capturePage.setViewportSize({ width, height: 820 })
    const layout = await capturePage.evaluate(() => {
      const controls = Array.from(document.querySelectorAll<HTMLElement>("button, input, textarea, summary"))
        .filter((element) => {
          const rect = element.getBoundingClientRect()
          const style = getComputedStyle(element)
          return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none"
        })
        .map((element) => {
          const rect = element.getBoundingClientRect()
          return { label: element.getAttribute("aria-label") || element.textContent?.trim().slice(0, 50) || element.tagName, width: rect.width, height: rect.height }
        })
      return {
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        undersized: controls.filter((control) => control.width < 44 || control.height < 44),
      }
    })
    expect(layout.overflow, `${width}px horizontal overflow`).toBeLessThanOrEqual(1)
    expect(layout.undersized, `${width}px controls smaller than 44px`).toEqual([])
  }

  await capturePage.setViewportSize({ width: 1280, height: 900 })
  if (process.env.ROOTLINE_SCREENSHOTS === "1") {
    await capturePage.screenshot({ path: "/tmp/rootline-capture-1280.png", fullPage: true })
  }

  const downloadsBeforeCopy = await capturePage.evaluate(async () => chrome.downloads.search({}))
  await capturePage.getByRole("button", { name: "复制 AI 上下文" }).first().click()
  await expect(capturePage.getByText(/AI 上下文已复制/)).toBeVisible()
  expect(await capturePage.evaluate(async () => (await chrome.downloads.search({})).length)).toBe(downloadsBeforeCopy.length)

  await capturePage.getByRole("tab", { name: /问题/ }).click()
  await capturePage.getByLabel("补充说明").fill("复制上下文前补充的复现说明。")
  await capturePage.getByRole("button", { name: "复制 AI 上下文" }).first().click()
  await expect.poll(async () => (await capturePage.evaluate(async () => chrome.downloads.search({}))).length).toBe(downloadsBeforeCopy.length + 2)
  const downloadsAfterEdit = await capturePage.evaluate(async () => chrome.downloads.search({}))
  const newDownloads = downloadsAfterEdit.filter((item) => !downloadsBeforeCopy.some((previous) => previous.id === item.id))
  const updatedReportDownloadIds = await capturePage.evaluate(async () => {
    const directoryName = new URL(location.href).searchParams.get("record")
    if (!directoryName) return []
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("rootline-capture-history", 1)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    const stored = await new Promise<{ report?: { localArtifacts?: { downloadIds?: { markdown?: number; json?: number } } } }>((resolve, reject) => {
      const request = database.transaction("records", "readonly").objectStore("records").get(directoryName)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    const ids = stored.report?.localArtifacts?.downloadIds
    return [ids?.markdown, ids?.json].filter((id): id is number => typeof id === "number")
  })
  expect(newDownloads.map((item) => item.id).sort((left, right) => left - right)).toEqual(updatedReportDownloadIds.sort((left, right) => left - right))

  await capturePage.getByRole("button", { name: "复制 AI 上下文" }).first().click()
  await expect(capturePage.getByText(/AI 上下文已复制/)).toBeVisible()
  expect(await capturePage.evaluate(async () => (await chrome.downloads.search({})).length)).toBe(downloadsAfterEdit.length)

  await capturePage.getByRole("tab", { name: "AI 上下文" }).click()
  await expect(capturePage.getByText("AI 角色与安全边界")).toBeVisible()

  const { markdown, json, capture, directoryName, directoryPath, capturePath } = initialExportedFiles
  expect(directoryName).toMatch(/^rootline-capture-\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}-[a-f0-9]{8}$/)
  expect(await capturePage.locator("body").innerText()).toContain(directoryPath)
  expect(markdown).toContain("点击保存后接口返回错误")
  expect(markdown).toContain("结果区域应展示保存失败原因")
  expect(markdown).toContain("逐文件改动计划")
  expect(json).toContain('"fileName": "capture.png"')
  expect(json).not.toContain("data:image/png")
  expect(markdown).toContain(capturePath)
  expect((await sharp(capture).metadata()).format).toBe("png")
  for (const secret of ["query-secret", "auth-secret", "request-secret", "response-secret", "console-secret", "xhr-auth-secret"]) {
    expect(markdown).not.toContain(secret)
    expect(json).not.toContain(secret)
  }

  const historyPage = await openExtensionTab("capture-history.html")
  await expect(historyPage.getByRole("heading", { name: "采集历史" })).toBeVisible()
  const historyRecord = historyPage.locator(".history-record").filter({ hasText: "Rootline React Fixture" }).first()
  await expect(historyRecord).toBeVisible()
  await expect(historyRecord.getByText(directoryPath)).toBeVisible()
  await historyRecord.getByRole("button", { name: "复制 AI 上下文" }).click()
  await expect(historyPage.getByText(/AI 上下文已复制/)).toBeVisible()
  await expect(historyPage.getByText(/AI 上下文已复制/)).toBeHidden({ timeout: 4_000 })
  await historyRecord.getByRole("button", { name: "重新导出报告" }).click()
  await expect(historyPage.getByText(/原保存位置重新导出/)).toBeVisible()
  for (const width of [320, 375, 414, 768]) {
    await historyPage.setViewportSize({ width, height: 820 })
    expect(await historyPage.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), `${width}px history overflow`).toBeLessThanOrEqual(1)
  }
  await historyPage.close()

  await fixturePage.bringToFront()
  const previousSessionId = await capturePage.evaluate(async () => {
    const active = await chrome.runtime.sendMessage({ type: "GET_ACTIVE_STATE" })
    return active?.data?.session?.id ?? null
  })
  await completion.getByRole("button", { name: "重新标注" }).click()
  await expect(fixturePage.locator("#rootline-runtime-overlay").locator("[data-workflow]")).toBeVisible()
  const reannotated = await capturePage.evaluate(async (previousId) => {
    const active = await chrome.runtime.sendMessage({ type: "GET_ACTIVE_STATE" })
    const currentId = active?.data?.session?.id
    if (!currentId) return { currentId: null, previousStatus: null }
    const previous = previousId
      ? await chrome.runtime.sendMessage({ type: "GET_SESSION", sessionId: previousId })
      : null
    return { currentId, previousStatus: previous?.data?.status ?? null }
  }, previousSessionId)
  expect(reannotated.currentId).toBeTruthy()
  expect(reannotated.currentId).not.toBe(previousSessionId)
  expect(reannotated.previousStatus).toBe("exported")

  if (reannotated.currentId) {
    await capturePage.evaluate(async (ids) => {
      await chrome.runtime.sendMessage({ type: "DISCARD_SESSION", sessionId: ids.currentId })
      if (ids.previousId) await chrome.runtime.sendMessage({ type: "DISCARD_SESSION", sessionId: ids.previousId })
    }, { currentId: reannotated.currentId, previousId: previousSessionId })
  }
})

test("degrades safely on plain HTML and explains restricted pages", async () => {
  const plainPage = await context.newPage()
  await plainPage.goto("http://127.0.0.1:4178/html.html")
  await startSession(plainPage)
  await annotateElement(plainPage, '[data-testid="plain-button"]', "普通按钮没有反馈。", "按钮应显示操作结果。")
  await finishFromPage(plainPage)
  const capturePage = await openReviewFromPage(plainPage)
  await capturePage.getByRole("tab", { name: /元素/ }).click()
  await expect(capturePage.getByText(/未暴露 React Fiber/)).toBeVisible()

  await capturePage.evaluate(async () => {
    const active = await chrome.runtime.sendMessage({ type: "GET_ACTIVE_STATE" })
    const id = active?.data?.session?.id
    if (id) await chrome.runtime.sendMessage({ type: "DISCARD_SESSION", sessionId: id })
  })
  const restricted = await context.newPage()
  await restricted.goto("chrome://version")
  await restricted.bringToFront()
  const popup = await openExtensionTab("popup.html")
  await expect(popup.getByText("当前页面不可采集")).toBeVisible()
  await expect(popup.getByText(/Chrome 内部页、扩展商店和 PDF/)).toBeVisible()

  const instructions = await openExtensionTab("instructions.html")
  for (const width of [320, 375, 414, 768]) {
    await instructions.setViewportSize({ width, height: 800 })
    expect(await instructions.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), `${width}px instructions overflow`).toBeLessThanOrEqual(1)
  }
  await capturePage.evaluate(() => chrome.storage.session.clear())
})
