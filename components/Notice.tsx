import { AlertCircle, AlertTriangle, CheckCircle2, Info } from "lucide-react"
import type { ReactNode } from "react"

type NoticeTone = "error" | "warning" | "success" | "info"

const icons = {
  error: AlertCircle,
  warning: AlertTriangle,
  success: CheckCircle2,
  info: Info,
}

export function Notice({ children, title, tone = "info" }: { children?: ReactNode; title: string; tone?: NoticeTone }) {
  const Icon = icons[tone]
  return (
    <div className="notice" data-tone={tone} role={tone === "error" ? "alert" : "status"}>
      <Icon aria-hidden="true" className="notice__icon" size={18} />
      <div className="min-w-0">
        <p className="m-0 font-bold leading-snug">{title}</p>
        {children ? <div className="mt-1 text-xs leading-relaxed">{children}</div> : null}
      </div>
    </div>
  )
}
