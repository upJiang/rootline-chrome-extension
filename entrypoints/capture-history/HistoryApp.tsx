import {
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  ClipboardCopy,
  ExternalLink,
  FileOutput,
  Filter,
  History,
  ImageOff,
  LoaderCircle,
  RefreshCw,
  Search,
  Video,
  X,
} from "lucide-react"
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { Brand } from "../../components/Brand"
import { LocaleToggle, useI18n } from "../../components/LocaleToggle"
import { Notice } from "../../components/Notice"
import { formatDateTime, formatMonth, localizeKnownCopy, t } from "../../src/lib/i18n"
import { downloadArtifactUrl } from "../../src/lib/download-artifacts"
import { listCaptureHistory, openCaptureRecording, readCaptureRecord, reexportCaptureRecord } from "../../src/lib/local-artifacts"
import { assessReportCompleteness, buildRemoteAiContext, buildReportMarkdown } from "../../src/lib/report"
import type { CaptureHistoryItem } from "../../src/lib/local-artifacts"
import { dateRangeForPreset, historyDateRangeError, historyPageCount, HISTORY_PAGE_SIZE, matchesHistoryDateRange, type HistoryDatePreset, type HistoryDateRange } from "./history-filters"

type Feedback = { tone: "success" | "error"; message: string }
type HistoryAction = "view" | "download" | "copy" | "recording"

function actionKey(directoryName: string, action: HistoryAction): string {
  return `${action}:${directoryName}`
}

function displayTime(value: string): string {
  return formatDateTime(value, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  })
}

function dateErrorText(error: string | null): string | null {
  if (error === "请输入有效的日期。") return t("historyInvalidDate")
  if (error === "开始日期不能晚于结束日期。") return t("historyDateOrder")
  return error
}

function formatDuration(durationMs: number): string {
  const seconds = Math.max(0, Math.floor(durationMs / 1_000))
  const minutes = Math.floor(seconds / 60)
  return `${String(minutes).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`
}

function calendarWeekdays(): string[] {
  return t("historyWeekdays").split(",")
}

function calendarDateValue(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`
}

function parseCalendarDate(value: string): Date | null {
  const parts = value.match(/^(\d{4})-(\d{2})-(\d{2})$/)?.slice(1).map(Number)
  if (!parts || parts.length !== 3) return null
  const [year, month, day] = parts as [number, number, number]
  const date = new Date(year, month - 1, day)
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day ? date : null
}

function calendarMonthStart(value?: string): Date {
  const parsed = value ? parseCalendarDate(value) : null
  const date = parsed ?? new Date()
  return new Date(date.getFullYear(), date.getMonth(), 1)
}

function shiftCalendarMonth(month: Date, amount: number): Date {
  return new Date(month.getFullYear(), month.getMonth() + amount, 1)
}

function calendarDays(month: Date): Date[] {
  const firstWeekday = (month.getDay() + 6) % 7
  const start = new Date(month.getFullYear(), month.getMonth(), 1 - firstWeekday)
  return Array.from({ length: 42 }, (_, index) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + index))
}

function CalendarMonth({ month, range, onSelect }: { month: Date; range: HistoryDateRange; onSelect: (value: string) => void }) {
  const from = parseCalendarDate(range.from)?.getTime() ?? null
  const to = parseCalendarDate(range.to)?.getTime() ?? null
  const today = calendarDateValue(new Date())
  const monthLabel = formatMonth(month)
  return <section aria-label={monthLabel} className="history-calendar-month">
    <h3>{monthLabel}</h3>
    <div className="history-calendar-weekdays" aria-hidden="true">{calendarWeekdays().map((weekday) => <span key={weekday}>{weekday}</span>)}</div>
    <div className="history-calendar-days">
      {calendarDays(month).map((date) => {
        const value = calendarDateValue(date)
        const timestamp = date.getTime()
        const selected = value === range.from || value === range.to
        const inRange = from !== null && to !== null && timestamp >= from && timestamp <= to
        return <button
          aria-label={value}
          className="history-calendar-day"
          data-in-range={inRange || undefined}
          data-outside={date.getMonth() !== month.getMonth() || undefined}
          data-selected={selected || undefined}
          data-today={value === today || undefined}
          key={value}
          onClick={() => onSelect(value)}
          type="button"
        >{date.getDate()}</button>
      })}
    </div>
  </section>
}

async function copyText(value: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(value)
  } catch {
    const textarea = document.createElement("textarea")
    textarea.value = value
    textarea.style.position = "fixed"
    textarea.style.opacity = "0"
    document.body.append(textarea)
    textarea.select()
    const copied = document.execCommand("copy")
    textarea.remove()
    if (!copied) throw new Error(t("historyClipboardDenied"))
  }
}

function FilterPreset({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return <button aria-pressed={active} className="history-filter-chip" data-active={active || undefined} onClick={onClick} type="button">{active ? <Check aria-hidden="true" size={14} /> : null}{label}</button>
}

function DateRangeFilter({ range, onChange, onClear }: { range: HistoryDateRange; onChange: (next: HistoryDateRange) => void; onClear: () => void }) {
  const [open, setOpen] = useState(false)
  const [calendarMonth, setCalendarMonth] = useState(() => calendarMonthStart(range.from || range.to))
  const rootRef = useRef<HTMLDivElement>(null)
  const hasDate = Boolean(range.from || range.to)
  const label = range.from && range.to ? t("historyDateBetween", { from: range.from, to: range.to }) : range.from ? t("historyDateFrom", { from: range.from }) : range.to ? t("historyDateUntil", { to: range.to }) : t("historyChooseDate")

  useEffect(() => {
    if (!open) return
    const handlePointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false)
    }
    document.addEventListener("pointerdown", handlePointerDown)
    document.addEventListener("keydown", handleKeyDown)
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown)
      document.removeEventListener("keydown", handleKeyDown)
    }
  }, [open])

  useEffect(() => {
    if (open) setCalendarMonth(calendarMonthStart(range.from || range.to))
  }, [open])

  const updateDate = (field: "from" | "to", value: string) => {
    onChange({ ...range, preset: "custom", [field]: value })
  }

  const selectCalendarDate = (value: string) => {
    if (!range.from || range.to) {
      onChange({ preset: "custom", from: value, to: "" })
      return
    }
    const start = parseCalendarDate(range.from)
    const selected = parseCalendarDate(value)
    if (!start || !selected || selected.getTime() < start.getTime()) {
      onChange({ preset: "custom", from: value, to: "" })
      return
    }
    onChange({ preset: "custom", from: range.from, to: value })
    setOpen(false)
  }

  const applyPreset = (preset: HistoryDatePreset) => {
    onChange({ preset, ...dateRangeForPreset(preset) })
    if (preset !== "custom") setOpen(false)
  }

  return (
    <div className="history-date-filter" ref={rootRef}>
      <div className="history-date-trigger-wrap">
        <button aria-expanded={open} aria-haspopup="dialog" className="history-date-trigger" onClick={() => setOpen((current) => !current)} type="button">
          <span className="history-date-trigger__lead">
            <span aria-hidden="true" className="history-control-icon"><CalendarDays size={16} /></span>
            <span className="history-date-trigger__label">{t("historyDateRange")}</span>
          </span>
          <span className="history-date-trigger__value">{label}</span>
        </button>
        {hasDate ? <button aria-label={t("historyClearDate")} className="history-date-clear" onClick={() => { onClear(); setOpen(false) }} title={t("historyClearDate")} type="button"><X aria-hidden="true" size={15} /></button> : null}
      </div>
      {open ? <div aria-label={t("historyChooseRange")} className="history-date-popover" role="dialog">
        <div className="history-date-popover__heading"><span>{t("historyDateHeading")}</span><button aria-label={t("historyCloseDate")} className="history-date-popover__close" onClick={() => setOpen(false)} type="button"><X aria-hidden="true" size={15} /></button></div>
        <div aria-label={t("historyDatePresets")} className="history-filter-presets" role="group">
          <FilterPreset active={range.preset === "all"} label={t("historyAll")} onClick={() => applyPreset("all")} />
          <FilterPreset active={range.preset === "today"} label={t("historyToday")} onClick={() => applyPreset("today")} />
          <FilterPreset active={range.preset === "7d"} label={t("history7d")} onClick={() => applyPreset("7d")} />
          <FilterPreset active={range.preset === "30d"} label={t("history30d")} onClick={() => applyPreset("30d")} />
        </div>
        <div className="history-date-fields">
          <label><span>{t("historyStartDate")}</span><input aria-label={t("historyStartDate")} inputMode="numeric" onChange={(event) => updateDate("from", event.currentTarget.value)} onInput={(event) => updateDate("from", event.currentTarget.value)} placeholder="YYYY-MM-DD" type="text" value={range.from} /></label>
          <span className="history-date-separator" aria-hidden="true">{t("historyTo")}</span>
          <label><span>{t("historyEndDate")}</span><input aria-label={t("historyEndDate")} inputMode="numeric" onChange={(event) => updateDate("to", event.currentTarget.value)} onInput={(event) => updateDate("to", event.currentTarget.value)} placeholder="YYYY-MM-DD" type="text" value={range.to} /></label>
        </div>
        <div className="history-calendar-toolbar">
          <button aria-label={t("historyPrevYear")} className="history-calendar-nav" onClick={() => setCalendarMonth((current) => shiftCalendarMonth(current, -12))} type="button"><ChevronsLeft aria-hidden="true" size={18} /></button>
          <button aria-label={t("historyPrevMonth")} className="history-calendar-nav" onClick={() => setCalendarMonth((current) => shiftCalendarMonth(current, -1))} type="button"><ChevronLeft aria-hidden="true" size={18} /></button>
          <span>{formatMonth(calendarMonth)}</span>
          <span>{formatMonth(shiftCalendarMonth(calendarMonth, 1))}</span>
          <button aria-label={t("historyNextMonth")} className="history-calendar-nav" onClick={() => setCalendarMonth((current) => shiftCalendarMonth(current, 1))} type="button"><ChevronRight aria-hidden="true" size={18} /></button>
          <button aria-label={t("historyNextYear")} className="history-calendar-nav" onClick={() => setCalendarMonth((current) => shiftCalendarMonth(current, 12))} type="button"><ChevronsRight aria-hidden="true" size={18} /></button>
        </div>
        <div className="history-calendar-panels">
          <CalendarMonth month={calendarMonth} onSelect={selectCalendarDate} range={range} />
          <CalendarMonth month={shiftCalendarMonth(calendarMonth, 1)} onSelect={selectCalendarDate} range={range} />
        </div>
      </div> : null}
    </div>
  )
}

function HistoryActionButton({ busy, icon, label, loadingLabel, onClick, primary = false }: { busy: boolean; icon: ReactNode; label: string; loadingLabel: string; onClick: () => void; primary?: boolean }) {
  return <button aria-busy={busy || undefined} className={`rl-button${primary ? " rl-button--primary" : ""}`} data-state={busy ? "loading" : undefined} disabled={busy} onClick={onClick} type="button">{busy ? <LoaderCircle aria-hidden="true" className="animate-spin" size={15} /> : icon}{busy ? loadingLabel : label}</button>
}

function CapturePreview({ item }: { item: CaptureHistoryItem }) {
  const [failed, setFailed] = useState(false)
  if (!item.captureDataUrl || failed) {
    return <div className="history-record__preview history-record__preview--empty"><ImageOff aria-hidden="true" size={24} /><span>{item.captureState === "missing" ? t("historyShotMissing") : t("historyNoShot")}</span></div>
  }
  return <div className="history-record__preview"><img alt={t("historyShotAlt", { title: item.report?.page.title ?? t("historyCaptureRecord") })} decoding="async" loading="lazy" onError={() => setFailed(true)} src={item.captureDataUrl} /></div>
}

function HistoryMasonryItem({ children, invalid = false }: { children: ReactNode; invalid?: boolean }) {
  const itemRef = useRef<HTMLElement>(null)
  useLayoutEffect(() => {
    const item = itemRef.current
    if (!item) return
    const updateSpan = () => {
      const styles = getComputedStyle(item.parentElement ?? item)
      const rowHeight = Number.parseFloat(styles.gridAutoRows) || 4
      const rowGap = Number.parseFloat(styles.rowGap) || 14
      item.style.gridRowEnd = `span ${Math.ceil((item.getBoundingClientRect().height + rowGap) / (rowHeight + rowGap))}`
    }
    updateSpan()
    const observer = new ResizeObserver(updateSpan)
    observer.observe(item)
    return () => observer.disconnect()
  }, [])
  return <article className={`history-record${invalid ? " history-record--invalid" : ""}`} ref={itemRef}>{children}</article>
}

export function HistoryApp() {
  const { locale } = useI18n()
  const [records, setRecords] = useState<CaptureHistoryItem[]>([])
  const [query, setQuery] = useState("")
  const [dateRange, setDateRange] = useState<HistoryDateRange>(() => ({ preset: "all", ...dateRangeForPreset("all") }))
  const [page, setPage] = useState(1)
  const [busyActions, setBusyActions] = useState<Set<string>>(() => new Set())
  const [feedback, setFeedback] = useState<Feedback | null>(null)
  const feedbackTimer = useRef<number | null>(null)

  const showFeedback = useCallback((next: Feedback) => {
    if (feedbackTimer.current !== null) window.clearTimeout(feedbackTimer.current)
    setFeedback(next)
    feedbackTimer.current = next.tone === "success"
      ? window.setTimeout(() => {
          setFeedback(null)
          feedbackTimer.current = null
        }, 3_000)
      : null
  }, [])

  useEffect(() => () => {
    if (feedbackTimer.current !== null) window.clearTimeout(feedbackTimer.current)
  }, [])

  useEffect(() => {
    document.title = t("historyDocumentTitle")
  }, [locale])

  const refresh = useCallback(async () => {
    setRecords(await listCaptureHistory())
  }, [])

  useEffect(() => {
    void refresh().catch((error: unknown) => showFeedback({ tone: "error", message: error instanceof Error ? error.message : t("historyReadFailed") }))
  }, [refresh, showFeedback])

  const run = async (key: string, operation: () => Promise<void>) => {
    setBusyActions((current) => new Set(current).add(key))
    setFeedback(null)
    try {
      await operation()
    } catch (error) {
      showFeedback({ tone: "error", message: error instanceof Error ? error.message : t("commonOperationFailed") })
    } finally {
      setBusyActions((current) => {
        const next = new Set(current)
        next.delete(key)
        return next
      })
    }
  }

  const openRecord = (directoryName: string) => run(actionKey(directoryName, "view"), async () => {
    await chrome.tabs.create({ url: chrome.runtime.getURL(`capture.html?record=${encodeURIComponent(directoryName)}`) })
    showFeedback({ tone: "success", message: t("historyOpened") })
  })

  const downloadRecord = (directoryName: string) => run(actionKey(directoryName, "download"), async () => {
    const record = await readCaptureRecord(directoryName)
    if (record.remoteLocation) {
      const downloaded = await downloadArtifactUrl(`Rootline/${directoryName}/report.html`, record.remoteLocation.reportUrl)
      showFeedback({ tone: "success", message: t("historyDownloadedRemote", { filename: downloaded.filename }) })
      return
    }
    const rewritten = await reexportCaptureRecord(directoryName)
    await refresh()
    showFeedback({ tone: "success", message: t("historyDownloadedLocal", { path: rewritten.location?.directoryPath ?? t("historyOriginalLocation") }) })
  })

  const copyRecord = (directoryName: string) => run(actionKey(directoryName, "copy"), async () => {
    const record = await readCaptureRecord(directoryName)
    await copyText(record.remoteLocation ? buildRemoteAiContext(record.remoteLocation) : buildReportMarkdown(record.report))
    showFeedback({ tone: "success", message: record.remoteLocation ? t("historyContextCopiedRemote") : t("historyContextCopiedLocal") })
  })

  const openRecording = (directoryName: string) => run(actionKey(directoryName, "recording"), async () => {
    const record = await readCaptureRecord(directoryName)
    const state = await openCaptureRecording(directoryName)
    if (state === "missing") throw new Error(record.remoteLocation ? t("historyRemoteRecordingExpired") : t("historyLocalRecordingMissing"))
    if (state === "unknown") throw new Error(t("historyRecordingUnknown"))
    showFeedback({ tone: "success", message: record.remoteLocation ? t("historyRemoteRecordingOpened") : t("historyLocalRecordingOpened") })
  })

  const clearFilters = () => {
    setQuery("")
    setDateRange({ preset: "all", ...dateRangeForPreset("all") })
  }

  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase()
    return records.filter((item) => {
      const matchesQuery = !normalized || [item.directoryName, item.report?.page.title, item.report?.page.url]
        .some((value) => value?.toLocaleLowerCase().includes(normalized))
      return matchesQuery && matchesHistoryDateRange(item, dateRange)
    })
  }, [dateRange, query, records])

  const dateError = historyDateRangeError(dateRange)
  const hasFilters = Boolean(query.trim() || dateRange.from || dateRange.to)
  const pageCount = historyPageCount(filtered.length)
  const currentPage = Math.min(page, pageCount)
  const pageNumbers = useMemo(() => {
    const start = Math.max(1, Math.min(currentPage - 2, pageCount - 4))
    const end = Math.min(pageCount, start + 4)
    return Array.from({ length: end - start + 1 }, (_, index) => start + index)
  }, [currentPage, pageCount])
  const visibleRecords = useMemo(() => {
    const start = (currentPage - 1) * HISTORY_PAGE_SIZE
    return filtered.slice(start, start + HISTORY_PAGE_SIZE)
  }, [currentPage, filtered])

  useEffect(() => {
    setPage(1)
  }, [dateRange, query, records])

  const isBusy = (key: string) => busyActions.has(key)

  return (
    <main className="history-shell">
      <header className="history-header">
        <Brand />
        <div className="history-header__tools">
          <LocaleToggle />
          <button aria-busy={isBusy("refresh") || undefined} aria-label={t("historyRefresh")} className="rl-button rl-icon-button" data-state={isBusy("refresh") ? "loading" : undefined} disabled={isBusy("refresh")} onClick={() => void run("refresh", refresh)} title={t("historyRefresh")} type="button">
            {isBusy("refresh") ? <LoaderCircle aria-hidden="true" className="animate-spin" size={17} /> : <RefreshCw aria-hidden="true" size={17} />}
          </button>
        </div>
      </header>

      {feedback ? <Notice title={localizeKnownCopy(feedback.message)} tone={feedback.tone} /> : null}

      <section className="history-section" aria-labelledby="history-title">
        <div className="history-section__heading">
          <div><p className="section-kicker">{t("historyKicker")}</p><h1 id="history-title">{t("historyTitle")}</h1></div>
          <div aria-live="polite" className="history-count"><span>{filtered.length}</span><small>{t("historyCount", { count: records.length })}</small></div>
        </div>

        <div className="history-filters" aria-label={t("historyFilters")} role="search">
          <div className="history-filter-toolbar">
            <div className="history-search">
              <span className="history-search__lead">
                <span aria-hidden="true" className="history-control-icon"><Search size={17} /></span>
                <label className="history-search__label" htmlFor="history-search-input">{t("historySearch")}</label>
              </span>
              <input id="history-search-input" onChange={(event) => setQuery(event.target.value)} placeholder={t("historySearchPlaceholder")} value={query} />
              {query ? <button aria-label={t("historyClearSearch")} className="history-search__clear" onClick={() => setQuery("")} title={t("historyClearSearch")} type="button"><X aria-hidden="true" size={15} /></button> : null}
            </div>
            <div className="history-filter-controls">
              <DateRangeFilter range={dateRange} onChange={setDateRange} onClear={() => setDateRange({ preset: "all", ...dateRangeForPreset("all") })} />
              {dateError ? <p className="history-date-error" role="alert">{dateErrorText(dateError)}</p> : null}
            </div>
            {hasFilters ? <button className="history-clear" onClick={clearFilters} type="button"><X aria-hidden="true" size={15} />{t("historyClearFilters")}</button> : <span className="history-filter-status"><Filter aria-hidden="true" size={14} />{t("historyShowingAll")}</span>}
          </div>
        </div>

        {filtered.length === 0 ? <div className="history-empty"><History aria-hidden="true" size={22} /><p>{records.length === 0 ? t("historyEmpty") : t("historyNoMatch")}</p></div> : null}
        <div className="history-list">
          {visibleRecords.map((item) => item.state === "ready" && item.report && (item.location || item.remoteLocation) ? (
            <HistoryMasonryItem key={item.directoryName}>
              <CapturePreview item={item} />
              <div className="history-record__body">
                <div className="history-record__main"><div className="history-record__heading"><p className="history-record__title" title={item.report.page.title}>{item.report.page.title}</p><p className="history-record__url" title={item.report.page.url}>{item.report.page.url}</p></div><time dateTime={item.report.generatedAt}>{displayTime(item.report.generatedAt)}</time></div>
                <div className="history-record__metrics">
                  {item.report.recording ? <span className="recording-metric" data-missing={item.recordingState === "missing" || undefined}><Video aria-hidden="true" size={13} />{item.recordingState === "available" ? t("historyRecordingDuration", { duration: formatDuration(item.report.recording.durationMs) }) : item.recordingState === "missing" ? t("historyRecordingFileMissing") : t("historyRecordingUnconfirmed")}</span> : <span>{t("historyAnnotatedShot")}</span>}
                  {item.remoteLocation ? <span data-error={item.markdownState === "missing" || undefined}>{item.markdownState === "available" ? t("historyRemoteReachable") : item.markdownState === "missing" ? t("historyRemoteUnreachable") : t("historyRemotePending")}</span> : null}
                  <span>{t("historyCompleteness", { score: assessReportCompleteness(item.report).score })}</span>
                  <span>{t("historyElementCount", { count: item.report.targets.length })}</span>
                  <span data-error={item.report.console.some((entry) => entry.level === "error") || undefined}>{t("historyErrorCount", { count: item.report.console.filter((entry) => entry.level === "error").length })}</span>
                  <span>{t("historyRequestCount", { count: item.report.network.length })}</span>
                </div>
                <code className="history-record__path" title={item.remoteLocation?.reportUrl ?? item.location?.directoryPath}>{item.remoteLocation?.reportUrl ?? item.location?.directoryPath}</code>
                <div className="history-record__actions">
                  {!item.remoteLocation ? <HistoryActionButton busy={isBusy(actionKey(item.directoryName, "view"))} icon={<ExternalLink aria-hidden="true" size={15} />} label={t("historyViewReport")} loadingLabel={t("historyOpening")} onClick={() => void openRecord(item.directoryName)} primary /> : null}
                  <HistoryActionButton busy={isBusy(actionKey(item.directoryName, "download"))} icon={<FileOutput aria-hidden="true" size={15} />} label={t("historyDownloadReport")} loadingLabel={t("historyDownloading")} onClick={() => void downloadRecord(item.directoryName)} />
                  {item.report.recording && (item.remoteLocation?.recordingUrl || typeof item.location?.downloadIds?.recording === "number") ? <HistoryActionButton busy={isBusy(actionKey(item.directoryName, "recording"))} icon={<Video aria-hidden="true" size={15} />} label={t("historyViewRecording")} loadingLabel={t("historyOpening")} onClick={() => void openRecording(item.directoryName)} /> : null}
                  <HistoryActionButton busy={isBusy(actionKey(item.directoryName, "copy"))} icon={<ClipboardCopy aria-hidden="true" size={15} />} label={t("historyCopyContext")} loadingLabel={t("historyCopying")} onClick={() => void copyRecord(item.directoryName)} />
                </div>
              </div>
            </HistoryMasonryItem>
          ) : (
            <HistoryMasonryItem invalid key={item.directoryName}><div className="history-record__preview history-record__preview--empty"><ImageOff aria-hidden="true" size={24} /><span>{t("historyRecordUnavailable")}</span></div><div className="history-record__body"><p className="history-record__title">{t("historyRecordUnreadable")}</p><code className="history-record__path">{item.directoryName}</code><p>{item.error ? localizeKnownCopy(item.error) : null}</p></div></HistoryMasonryItem>
          ))}
        </div>
        {pageCount > 1 ? <nav aria-label={t("historyPagination")} className="history-pagination">
          <button aria-label={t("historyFirstPage")} className="history-pagination__button" disabled={currentPage === 1} onClick={() => setPage(1)} type="button"><ChevronsLeft aria-hidden="true" size={16} /></button>
          <button aria-label={t("historyPrevPage")} className="history-pagination__button" disabled={currentPage === 1} onClick={() => setPage((value) => Math.max(1, value - 1))} type="button"><ChevronLeft aria-hidden="true" size={16} /></button>
          {pageNumbers.map((pageNumber) => <button aria-current={pageNumber === currentPage ? "page" : undefined} aria-label={t("historyPageNumber", { page: pageNumber })} className="history-pagination__button" data-current={pageNumber === currentPage || undefined} key={pageNumber} onClick={() => setPage(pageNumber)} type="button">{pageNumber}</button>)}
          <button aria-label={t("historyNextPage")} className="history-pagination__button" disabled={currentPage === pageCount} onClick={() => setPage((value) => Math.min(pageCount, value + 1))} type="button"><ChevronRight aria-hidden="true" size={16} /></button>
          <button aria-label={t("historyLastPage")} className="history-pagination__button" disabled={currentPage === pageCount} onClick={() => setPage(pageCount)} type="button"><ChevronsRight aria-hidden="true" size={16} /></button>
          <span aria-live="polite" className="history-pagination__status">{t("historyPageStatus", { current: currentPage, total: pageCount })}</span>
        </nav> : null}
      </section>
    </main>
  )
}
