import { GitBranch } from "lucide-react"

export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-[var(--color-ink)] text-[var(--color-accent)]">
        <GitBranch aria-hidden="true" size={19} strokeWidth={2.2} />
      </span>
      <div className="min-w-0">
        <p className="m-0 text-base font-extrabold leading-tight">Rootline</p>
        {!compact ? <p className="rl-muted m-0 truncate text-xs">Browser runtime capture</p> : null}
      </div>
    </div>
  )
}
