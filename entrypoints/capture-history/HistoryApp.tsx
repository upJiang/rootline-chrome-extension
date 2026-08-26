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
import { Notice } from "../../components/Notice"
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
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date)
}

function formatDuration(durationMs: number): string {
  const seconds = Math.max(0, Math.floor(durationMs / 1_000))
  const minutes = Math.floor(seconds / 60)
  return `${String(minutes).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`
}

const CALENDAR_WEEKDAYS = ["一", "二", "三", "四", "五", "六", "日"]

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
  return <section aria-label={`${month.getFullYear()}年${month.getMonth() + 1}月`} className="history-calendar-month">
    <h3>{month.getFullYear()}年 {month.getMonth() + 1}月</h3>
    <div className="history-calendar-weekdays" aria-hidden="true">{CALENDAR_WEEKDAYS.map((weekday) => <span key={weekday}>{weekday}</span>)}</div>
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
    if (!copied) throw new Error("浏览器拒绝访问剪贴板，请检查页面权限后重试。")
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
  const label = range.from && range.to ? `${range.from} 至 ${range.to}` : range.from ? `${range.from} 起` : range.to ? `截至 ${range.to}` : "选择日期"

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
          <CalendarDays aria-hidden="true" size={16} />
          <span className="history-date-trigger__label">时间范围</span>
          <span className="history-date-trigger__value">{label}</span>
        </button>
        {hasDate ? <button aria-label="清除日期筛选" className="history-date-clear" onClick={() => { onClear(); setOpen(false) }} title="清除日期筛选" type="button"><X aria-hidden="true" size={15} /></button> : null}
      </div>
      {open ? <div aria-label="选择日期范围" className="history-date-popover" role="dialog">
        <div className="history-date-popover__heading"><span>日期范围</span><button aria-label="关闭日期筛选" className="history-date-popover__close" onClick={() => setOpen(false)} type="button"><X aria-hidden="true" size={15} /></button></div>
        <div aria-label="快捷日期范围" className="history-filter-presets" role="group">
          <FilterPreset active={range.preset === "all"} label="全部" onClick={() => applyPreset("all")} />
          <FilterPreset active={range.preset === "today"} label="今天" onClick={() => applyPreset("today")} />
          <FilterPreset active={range.preset === "7d"} label="近 7 天" onClick={() => applyPreset("7d")} />
          <FilterPreset active={range.preset === "30d"} label="近 30 天" onClick={() => applyPreset("30d")} />
        </div>
        <div className="history-date-fields">
          <label><span>开始日期</span><input aria-label="开始日期" inputMode="numeric" onChange={(event) => updateDate("from", event.currentTarget.value)} onInput={(event) => updateDate("from", event.currentTarget.value)} placeholder="YYYY-MM-DD" type="text" value={range.from} /></label>
          <span className="history-date-separator" aria-hidden="true">至</span>
          <label><span>结束日期</span><input aria-label="结束日期" inputMode="numeric" onChange={(event) => updateDate("to", event.currentTarget.value)} onInput={(event) => updateDate("to", event.currentTarget.value)} placeholder="YYYY-MM-DD" type="text" value={range.to} /></label>
        </div>
        <div className="history-calendar-toolbar">
          <button aria-label="上一年" className="history-calendar-nav" onClick={() => setCalendarMonth((current) => shiftCalendarMonth(current, -12))} type="button"><ChevronsLeft aria-hidden="true" size={18} /></button>
          <button aria-label="上个月" className="history-calendar-nav" onClick={() => setCalendarMonth((current) => shiftCalendarMonth(current, -1))} type="button"><ChevronLeft aria-hidden="true" size={18} /></button>
          <span>{calendarMonth.getFullYear()}年 {calendarMonth.getMonth() + 1}月</span>
          <span>{shiftCalendarMonth(calendarMonth, 1).getFullYear()}年 {shiftCalendarMonth(calendarMonth, 1).getMonth() + 1}月</span>
          <button aria-label="下个月" className="history-calendar-nav" onClick={() => setCalendarMonth((current) => shiftCalendarMonth(current, 1))} type="button"><ChevronRight aria-hidden="true" size={18} /></button>
          <button aria-label="下一年" className="history-calendar-nav" onClick={() => setCalendarMonth((current) => shiftCalendarMonth(current, 12))} type="button"><ChevronsRight aria-hidden="true" size={18} /></button>
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
    return <div className="history-record__preview history-record__preview--empty"><ImageOff aria-hidden="true" size={24} /><span>{item.captureState === "missing" ? "截图文件缺失" : "没有可用截图"}</span></div>
  }
  return <div className="history-record__preview"><img alt={`页面截图：${item.report?.page.title ?? "采集记录"}`} decoding="async" loading="lazy" onError={() => setFailed(true)} src={item.captureDataUrl} /></div>
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

  const refresh = useCallback(async () => {
    setRecords(await listCaptureHistory())
  }, [])

  useEffect(() => {
    void refresh().catch((error: unknown) => showFeedback({ tone: "error", message: error instanceof Error ? error.message : "无法读取采集历史。" }))
  }, [refresh, showFeedback])

  const run = async (key: string, operation: () => Promise<void>) => {
    setBusyActions((current) => new Set(current).add(key))
    setFeedback(null)
    try {
      await operation()
    } catch (error) {
      showFeedback({ tone: "error", message: error instanceof Error ? error.message : "Rootline 操作失败。" })
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
    showFeedback({ tone: "success", message: "报告已打开。" })
  })

  const downloadRecord = (directoryName: string) => run(actionKey(directoryName, "download"), async () => {
    const record = await readCaptureRecord(directoryName)
    if (record.remoteLocation) {
      const downloaded = await downloadArtifactUrl(`Rootline/${directoryName}/report.html`, record.remoteLocation.reportUrl)
      showFeedback({ tone: "success", message: `远程报告已下载到 ${downloaded.filename}。` })
      return
    }
    const rewritten = await reexportCaptureRecord(directoryName)
    await refresh()
    showFeedback({ tone: "success", message: `报告已下载到 ${rewritten.location?.directoryPath ?? "原保存位置"}。` })
  })

  const copyRecord = (directoryName: string) => run(actionKey(directoryName, "copy"), async () => {
    const record = await readCaptureRecord(directoryName)
    await copyText(record.remoteLocation ? buildRemoteAiContext(record.remoteLocation) : buildReportMarkdown(record.report))
    showFeedback({ tone: "success", message: record.remoteLocation ? "AI 上下文已复制，复用现有 COS 链接。" : "AI 上下文已复制，包含本地证据的绝对路径。" })
  })

  const openRecording = (directoryName: string) => run(actionKey(directoryName, "recording"), async () => {
    const record = await readCaptureRecord(directoryName)
    const state = await openCaptureRecording(directoryName)
    if (state === "missing") throw new Error(record.remoteLocation ? "远程录屏链接已经失效。" : "本地录屏文件已经缺失。")
    if (state === "unknown") throw new Error("Chrome 下载记录已被清理，无法确认录屏文件位置。")
    showFeedback({ tone: "success", message: record.remoteLocation ? "远程录屏已打开。" : "本地录屏已打开。" })
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
        <button aria-busy={isBusy("refresh") || undefined} aria-label="刷新历史" className="rl-button rl-icon-button" data-state={isBusy("refresh") ? "loading" : undefined} disabled={isBusy("refresh")} onClick={() => void run("refresh", refresh)} title="刷新历史" type="button">
          {isBusy("refresh") ? <LoaderCircle aria-hidden="true" className="animate-spin" size={17} /> : <RefreshCw aria-hidden="true" size={17} />}
        </button>
      </header>

      {feedback ? <Notice title={feedback.message} tone={feedback.tone} /> : null}

      <section className="history-section" aria-labelledby="history-title">
        <div className="history-section__heading">
          <div><p className="section-kicker">Evidence archive</p><h1 id="history-title">采集历史</h1></div>
          <div aria-live="polite" className="history-count"><span>{filtered.length}</span><small> / {records.length} 条</small></div>
        </div>

        <div className="history-filters" aria-label="历史筛选" role="search">
          <div className="history-filter-toolbar">
            <div className="history-search">
              <Search aria-hidden="true" size={17} />
              <label className="history-search__label" htmlFor="history-search-input">搜索</label>
              <input id="history-search-input" onChange={(event) => setQuery(event.target.value)} placeholder="页面、域名或目录" value={query} />
              {query ? <button aria-label="清除搜索" className="history-search__clear" onClick={() => setQuery("")} title="清除搜索" type="button"><X aria-hidden="true" size={15} /></button> : null}
            </div>
            <div className="history-filter-controls">
              <DateRangeFilter range={dateRange} onChange={setDateRange} onClear={() => setDateRange({ preset: "all", ...dateRangeForPreset("all") })} />
              {dateError ? <p className="history-date-error" role="alert">{dateError}</p> : null}
            </div>
            {hasFilters ? <button className="history-clear" onClick={clearFilters} type="button"><X aria-hidden="true" size={15} />清除筛选</button> : <span className="history-filter-status"><Filter aria-hidden="true" size={14} />已显示全部</span>}
          </div>
        </div>

        {filtered.length === 0 ? <div className="history-empty"><History aria-hidden="true" size={22} /><p>{records.length === 0 ? "还没有采集记录。完成一次采集后，Rootline 会在这里保留本地索引。" : "没有匹配的采集记录。调整搜索词或时间范围后重试。"}</p></div> : null}
        <div className="history-list">
          {visibleRecords.map((item) => item.state === "ready" && item.report && (item.location || item.remoteLocation) ? (
            <HistoryMasonryItem key={item.directoryName}>
              <CapturePreview item={item} />
              <div className="history-record__body">
                <div className="history-record__main"><div className="history-record__heading"><p className="history-record__title" title={item.report.page.title}>{item.report.page.title}</p><p className="history-record__url" title={item.report.page.url}>{item.report.page.url}</p></div><time dateTime={item.report.generatedAt}>{displayTime(item.report.generatedAt)}</time></div>
                <div className="history-record__metrics">
                  {item.report.recording ? <span className="recording-metric" data-missing={item.recordingState === "missing" || undefined}><Video aria-hidden="true" size={13} />{item.recordingState === "available" ? `录屏 ${formatDuration(item.report.recording.durationMs)}` : item.recordingState === "missing" ? "录屏文件缺失" : "录屏位置无法确认"}</span> : <span>标注截图</span>}
                  {item.remoteLocation ? <span data-error={item.markdownState === "missing" || undefined}>{item.markdownState === "available" ? "远程链接可访问" : item.markdownState === "missing" ? "远程链接无法访问" : "远程链接待确认"}</span> : null}
                  <span>{assessReportCompleteness(item.report).score}% 完整度</span>
                  <span>{item.report.targets.length} 个元素</span>
                  <span data-error={item.report.console.some((entry) => entry.level === "error") || undefined}>{item.report.console.filter((entry) => entry.level === "error").length} 个错误</span>
                  <span>{item.report.network.length} 个请求</span>
                </div>
                <code className="history-record__path" title={item.remoteLocation?.reportUrl ?? item.location?.directoryPath}>{item.remoteLocation?.reportUrl ?? item.location?.directoryPath}</code>
                <div className="history-record__actions">
                  {!item.remoteLocation ? <HistoryActionButton busy={isBusy(actionKey(item.directoryName, "view"))} icon={<ExternalLink aria-hidden="true" size={15} />} label="查看报告" loadingLabel="正在打开" onClick={() => void openRecord(item.directoryName)} primary /> : null}
                  <HistoryActionButton busy={isBusy(actionKey(item.directoryName, "download"))} icon={<FileOutput aria-hidden="true" size={15} />} label="下载报告" loadingLabel="正在下载" onClick={() => void downloadRecord(item.directoryName)} />
                  {item.report.recording && (item.remoteLocation?.recordingUrl || typeof item.location?.downloadIds?.recording === "number") ? <HistoryActionButton busy={isBusy(actionKey(item.directoryName, "recording"))} icon={<Video aria-hidden="true" size={15} />} label="查看录屏" loadingLabel="正在打开" onClick={() => void openRecording(item.directoryName)} /> : null}
                  <HistoryActionButton busy={isBusy(actionKey(item.directoryName, "copy"))} icon={<ClipboardCopy aria-hidden="true" size={15} />} label="复制 AI 上下文" loadingLabel="正在复制" onClick={() => void copyRecord(item.directoryName)} />
                </div>
              </div>
            </HistoryMasonryItem>
          ) : (
            <HistoryMasonryItem invalid key={item.directoryName}><div className="history-record__preview history-record__preview--empty"><ImageOff aria-hidden="true" size={24} /><span>记录不可用</span></div><div className="history-record__body"><p className="history-record__title">无法读取采集记录</p><code className="history-record__path">{item.directoryName}</code><p>{item.error}</p></div></HistoryMasonryItem>
          ))}
        </div>
        {pageCount > 1 ? <nav aria-label="采集历史分页" className="history-pagination">
          <button aria-label="第一页" className="history-pagination__button" disabled={currentPage === 1} onClick={() => setPage(1)} type="button"><ChevronsLeft aria-hidden="true" size={16} /></button>
          <button aria-label="上一页" className="history-pagination__button" disabled={currentPage === 1} onClick={() => setPage((value) => Math.max(1, value - 1))} type="button"><ChevronLeft aria-hidden="true" size={16} /></button>
          {pageNumbers.map((pageNumber) => <button aria-current={pageNumber === currentPage ? "page" : undefined} aria-label={`第 ${pageNumber} 页`} className="history-pagination__button" data-current={pageNumber === currentPage || undefined} key={pageNumber} onClick={() => setPage(pageNumber)} type="button">{pageNumber}</button>)}
          <button aria-label="下一页" className="history-pagination__button" disabled={currentPage === pageCount} onClick={() => setPage((value) => Math.min(pageCount, value + 1))} type="button"><ChevronRight aria-hidden="true" size={16} /></button>
          <button aria-label="最后一页" className="history-pagination__button" disabled={currentPage === pageCount} onClick={() => setPage(pageCount)} type="button"><ChevronsRight aria-hidden="true" size={16} /></button>
          <span aria-live="polite" className="history-pagination__status">第 {currentPage} / {pageCount} 页</span>
        </nav> : null}
      </section>
    </main>
  )
}
