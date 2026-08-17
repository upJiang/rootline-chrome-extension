const SENSITIVE_KEY_PATTERN = /^(?:authorization|proxy-authorization|cookie|set-cookie|token|access[_-]?token|refresh[_-]?token|id[_-]?token|api[_-]?key|client[_-]?secret|password|passwd|pwd|session[_-]?id)$/i
const QUOTED_SECRET_PATTERN = /((?:proxy[_-]?authorization|set[_-]?cookie|access[_-]?token|refresh[_-]?token|id[_-]?token|api[_-]?key|client[_-]?secret|session[_-]?id|authorization|password|passwd|cookie|token|pwd|data-(?:token|password|secret))\s*[:=]\s*)(["'])(.*?)\2/gi
const INLINE_SECRET_PATTERN = /((?:proxy[_-]?authorization|set[_-]?cookie|access[_-]?token|refresh[_-]?token|id[_-]?token|api[_-]?key|client[_-]?secret|session[_-]?id|authorization|password|passwd|cookie|token|pwd)\s*[:=]\s*)([^&\s",;]+)/gi
const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi
const PHONE_PATTERN = /(?<!\d)(?:\+?86[-\s]?)?1[3-9]\d{9}(?!\d)/g
const ID_CARD_PATTERN = /(?<!\d)\d{17}[\dXx](?!\d)/g

export interface TruncatedText {
  value: string
  truncated: boolean
  originalLength: number
}

export function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY_PATTERN.test(key.trim())
}

export function redactText(value: string): string {
  return value
    .replace(QUOTED_SECRET_PATTERN, "$1$2[REDACTED]$2")
    .replace(INLINE_SECRET_PATTERN, "$1[REDACTED]")
    .replace(EMAIL_PATTERN, "[REDACTED_EMAIL]")
    .replace(PHONE_PATTERN, "[REDACTED_PHONE]")
    .replace(ID_CARD_PATTERN, "[REDACTED_ID]")
}

export function redactUrl(value: string): string {
  try {
    const url = new URL(value)
    for (const key of Array.from(url.searchParams.keys())) {
      if (isSensitiveKey(key)) url.searchParams.set(key, "[REDACTED]")
    }
    url.username = ""
    url.password = ""
    return redactText(url.toString())
  } catch {
    return redactText(value)
  }
}

export function redactHeaders(headers?: Record<string, string>): Record<string, string> | undefined {
  if (!headers) return undefined
  return Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [
      key,
      isSensitiveKey(key) ? "[REDACTED]" : redactText(String(value)),
    ]),
  )
}

export function redactStructured(value: unknown, depth = 0): unknown {
  if (depth > 8) return "[TRUNCATED_DEPTH]"
  if (Array.isArray(value)) return value.slice(0, 100).map((item) => redactStructured(item, depth + 1))
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .slice(0, 100)
        .map(([key, nested]) => [
          key,
          isSensitiveKey(key) ? "[REDACTED]" : redactStructured(nested, depth + 1),
        ]),
    )
  }
  return typeof value === "string" ? redactText(value) : value
}

export function redactBody(value: string | undefined, contentType = ""): string | undefined {
  if (!value) return value
  const normalizedType = contentType.toLowerCase()
  if (normalizedType.includes("json") || /^[\s]*[\[{]/.test(value)) {
    try {
      return JSON.stringify(redactStructured(JSON.parse(value)))
    } catch {
      return redactText(value)
    }
  }
  if (normalizedType.includes("x-www-form-urlencoded") || value.includes("=")) {
    try {
      const params = new URLSearchParams(value)
      for (const key of Array.from(params.keys())) {
        params.set(key, isSensitiveKey(key) ? "[REDACTED]" : redactText(params.get(key) ?? ""))
      }
      return params.toString()
    } catch {
      return redactText(value)
    }
  }
  return redactText(value)
}

export function truncateText(value: string, limit: number): TruncatedText {
  if (value.length <= limit) return { value, truncated: false, originalLength: value.length }
  return {
    value: `${value.slice(0, limit)}\n…[TRUNCATED ${value.length - limit} CHARACTERS]`,
    truncated: true,
    originalLength: value.length,
  }
}
