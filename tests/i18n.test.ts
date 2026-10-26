import { readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { getLocale, loadStoredLocale, localizeKnownCopy, LOCALE_STORAGE_KEY, resetLocaleForTests, setLocale, subscribeLocale, t } from "../src/lib/i18n"
import { messages } from "../src/lib/messages"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const store: Record<string, unknown> = {}
const listeners = new Set<(changes: Record<string, chrome.storage.StorageChange>, area: string) => void>()

beforeEach(() => {
  resetLocaleForTests()
  for (const key of Object.keys(store)) delete store[key]
  listeners.clear()
  vi.stubGlobal("chrome", {
    storage: {
      local: {
        get: vi.fn(async (key: string) => ({ [key]: store[key] })),
        set: vi.fn(async (values: Record<string, unknown>) => Object.assign(store, values)),
      },
      onChanged: {
        addListener: (listener: (changes: Record<string, chrome.storage.StorageChange>, area: string) => void) => {
          listeners.add(listener)
        },
      },
    },
  })
})

describe("locale store", () => {
  it("defaults to Chinese and substitutes variables", () => {
    expect(getLocale()).toBe("zh_CN")
    expect(t("overlayStartAnnotate")).toBe("开始标注")
    expect(t("overlayTargetLocked", { label: "button#save" })).toBe("已锁定 button#save。")
  })

  it("switches copy immediately and restores the saved choice", async () => {
    await setLocale("en")
    expect(t("overlayStartAnnotate")).toBe("Start annotating")
    expect(store[LOCALE_STORAGE_KEY]).toBe("en")

    resetLocaleForTests()
    expect(t("overlayStartAnnotate")).toBe("开始标注")
    await loadStoredLocale()
    expect(getLocale()).toBe("en")
    expect(t("brandTagline")).toBe("Browser runtime capture")
  })

  it("notifies listeners once and follows storage changes from other pages", async () => {
    const heard: string[] = []
    subscribeLocale((locale) => heard.push(locale))
    await setLocale("zh_CN")
    await setLocale("en")
    await setLocale("en")
    expect(heard).toEqual(["en"])

    await loadStoredLocale()
    for (const listener of listeners) listener({ [LOCALE_STORAGE_KEY]: { newValue: "zh_CN" } }, "local")
    expect(getLocale()).toBe("zh_CN")
    expect(t("popupStartAnnotate")).toBe("开始标注")
  })

  it("translates stored catalog sentences and keeps English free of Chinese", async () => {
    const unsupported = messages.zh_CN.popupUnsupportedDetail
    expect(localizeKnownCopy(unsupported)).toBe(unsupported)
    expect(t("popupRemote")).toBe("远程")
    await setLocale("en")
    expect(localizeKnownCopy(unsupported)).toBe(messages.en.popupUnsupportedDetail)
    expect(t("popupRemote")).toBe("Remote")
    expect(t("popupLocal")).toBe("Local")
    for (const value of Object.values(messages.en)) expect(value).not.toMatch(/[\u4e00-\u9fff]/)
  })

  it("keeps the Chinese and English catalogs aligned with the Chrome locale files", () => {
    expect(Object.keys(messages.en).sort()).toEqual(Object.keys(messages.zh_CN).sort())
    for (const locale of ["zh_CN", "en"] as const) {
      const file = JSON.parse(readFileSync(resolve(root, `public/_locales/${locale}/messages.json`), "utf8")) as Record<string, { message?: string }>
      const catalog = messages[locale]
      expect(Object.keys(file).sort()).toEqual(Object.keys(catalog).sort())
      for (const [key, message] of Object.entries(catalog)) {
        expect(file[key]).toEqual({ message })
      }
    }
  })
})
