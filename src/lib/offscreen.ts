import { t } from "./i18n"

let createPromise: Promise<void> | null = null

export async function ensureRootlineOffscreenDocument(): Promise<void> {
  if (!("offscreen" in chrome)) throw new Error(t("errorOffscreenUnsupported"))
  if (await chrome.offscreen.hasDocument()) return
  if (!createPromise) {
    createPromise = chrome.offscreen.createDocument({
      url: "offscreen.html",
      reasons: [
        chrome.offscreen.Reason.BLOBS,
        chrome.offscreen.Reason.DISPLAY_MEDIA,
        chrome.offscreen.Reason.USER_MEDIA,
      ],
      justification: "录制用户主动选择的屏幕，并生成只保存在本机的网页证据文件。",
    }).finally(() => { createPromise = null })
  }
  await createPromise
}
