import type { RemoteProvider } from "./types"
import { messages, type MessageKey, type MessageVars } from "./messages"

export type { MessageKey, MessageVars }

export const LOCALES = ["zh_CN", "en"] as const
export type Locale = (typeof LOCALES)[number]
export const DEFAULT_LOCALE: Locale = "zh_CN"
export const LOCALE_STORAGE_KEY = "rootline:locale"

type LocaleListener = (locale: Locale) => void

let currentLocale: Locale = DEFAULT_LOCALE
const listeners = new Set<LocaleListener>()
let storageWatchStarted = false

export function isLocale(value: unknown): value is Locale {
  return value === "zh_CN" || value === "en"
}

export function isMessageKey(value: string): value is MessageKey {
  return Object.prototype.hasOwnProperty.call(messages.zh_CN, value)
}

export function getLocale(): Locale {
  return currentLocale
}

export function intlLocale(): "zh-CN" | "en" {
  return currentLocale === "en" ? "en" : "zh-CN"
}

export function t(key: MessageKey, vars?: MessageVars): string {
  const catalog = currentLocale === "en" ? messages.en : messages.zh_CN
  const template = catalog[key] || messages.zh_CN[key] || key
  if (!vars) return template
  return template.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = vars[name]
    return value === undefined ? match : String(value)
  })
}

export function providerName(provider?: RemoteProvider): string {
  return t(provider === "aliyun-oss" ? "providerAliyun" : "providerTencent")
}

export function formatDateTime(value: string, options?: Intl.DateTimeFormatOptions): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat(intlLocale(), options ?? { hour12: false }).format(date)
}

export function formatMonth(date: Date): string {
  if (currentLocale === "en") {
    return new Intl.DateTimeFormat("en", { month: "long", year: "numeric" }).format(date)
  }
  return `${date.getFullYear()}年 ${date.getMonth() + 1}月`
}

export function subscribeLocale(listener: LocaleListener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function emit(locale: Locale): void {
  listeners.forEach((listener) => listener(locale))
}

export function applyLocale(locale: Locale): void {
  if (currentLocale === locale) return
  currentLocale = locale
  emit(locale)
}

function readStoredLocale(stored: unknown): Locale | null {
  if (!stored || typeof stored !== "object") return null
  const value = (stored as Record<string, unknown>)[LOCALE_STORAGE_KEY]
  return isLocale(value) ? value : null
}

function watchLocaleStorage(): void {
  if (storageWatchStarted) return
  const onChanged = globalThis.chrome?.storage?.onChanged
  if (!onChanged) return
  storageWatchStarted = true
  onChanged.addListener((changes, area) => {
    if (area !== "local") return
    const next = changes[LOCALE_STORAGE_KEY]?.newValue
    if (isLocale(next)) applyLocale(next)
  })
}

export async function loadStoredLocale(): Promise<Locale> {
  watchLocaleStorage()
  try {
    const stored = await globalThis.chrome?.storage?.local?.get(LOCALE_STORAGE_KEY)
    const locale = readStoredLocale(stored)
    if (locale) applyLocale(locale)
  } catch {
    // Extension storage is unavailable in unit tests and some page contexts.
  }
  return currentLocale
}

export async function setLocale(locale: Locale): Promise<void> {
  watchLocaleStorage()
  applyLocale(locale)
  try {
    await globalThis.chrome?.storage?.local?.set({ [LOCALE_STORAGE_KEY]: locale })
  } catch {
    // Keep the in-memory choice even if persistence is unavailable.
  }
}

export function resetLocaleForTests(): void {
  currentLocale = DEFAULT_LOCALE
  listeners.clear()
  storageWatchStarted = false
}
