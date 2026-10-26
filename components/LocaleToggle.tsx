import { useEffect, useState, type ReactNode } from "react"
import { getLocale, loadStoredLocale, setLocale, subscribeLocale, t, type Locale } from "../src/lib/i18n"

export function useI18n() {
  const [locale, setLocaleState] = useState<Locale>(getLocale)
  useEffect(() => subscribeLocale(setLocaleState), [])
  return { locale, setLocale, t }
}

export function LocaleProvider({ children }: { children: ReactNode }) {
  const { locale } = useI18n()
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let cancelled = false
    void loadStoredLocale().finally(() => {
      if (!cancelled) setReady(true)
    })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    document.documentElement.lang = locale === "en" ? "en" : "zh-CN"
  }, [locale])

  if (!ready) return null
  return children
}

export function LocaleToggle() {
  const { locale, setLocale: chooseLocale } = useI18n()
  return (
    <div aria-label={t("localeToggleLabel")} className="locale-toggle" role="group">
      <button aria-pressed={locale === "zh_CN"} onClick={() => void chooseLocale("zh_CN")} type="button">中</button>
      <button aria-pressed={locale === "en"} onClick={() => void chooseLocale("en")} type="button">EN</button>
    </div>
  )
}
