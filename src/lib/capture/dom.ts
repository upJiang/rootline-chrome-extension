import { redactText, truncateText } from "../redaction"
import type { CssRuleEvidence, ReactRuntimeHint, SelectedTarget, TargetRect, TargetSpacingEvidence } from "../types"

const COMPUTED_STYLE_PROPERTIES = [
  "display",
  "position",
  "z-index",
  "box-sizing",
  "width",
  "height",
  "min-width",
  "min-height",
  "max-width",
  "max-height",
  "margin",
  "padding",
  "gap",
  "grid-template-columns",
  "grid-template-rows",
  "grid-area",
  "align-items",
  "align-content",
  "justify-content",
  "justify-items",
  "flex",
  "flex-direction",
  "flex-wrap",
  "order",
  "overflow",
  "opacity",
  "visibility",
  "transform",
  "color",
  "background-color",
  "background-image",
  "border",
  "border-radius",
  "box-shadow",
  "font-family",
  "font-size",
  "font-weight",
  "line-height",
  "letter-spacing",
  "text-align",
  "white-space",
  "cursor",
  "pointer-events",
] as const

const SENSITIVE_ATTRIBUTE_PATTERN = /^(?:value|srcdoc|nonce|integrity|data-token|data-password)$/i

function cssEscape(value: string): string {
  if (globalThis.CSS?.escape) return globalThis.CSS.escape(value)
  return value.replace(/[^a-zA-Z0-9_-]/g, (character) => `\\${character}`)
}

function compactText(value: string | null | undefined, limit = 320): string | undefined {
  const normalized = redactText((value ?? "").replace(/\s+/g, " ").trim())
  return normalized ? truncateText(normalized, limit).value : undefined
}

function uniqueSelectorWithinRoot(element: Element, root: Document | ShadowRoot): string {
  const testId = element.getAttribute("data-testid")
  if (testId) {
    const selector = `[data-testid="${cssEscape(testId)}"]`
    if (root.querySelectorAll(selector).length === 1) return selector
  }
  if (element.id) {
    const selector = `#${cssEscape(element.id)}`
    if (root.querySelectorAll(selector).length === 1) return selector
  }
  const parts: string[] = []
  let current: Element | null = element
  while (current && parts.length < 8) {
    const tag = current.tagName.toLowerCase()
    const parent: Element | null = current.parentElement
    if (!parent) {
      parts.unshift(tag)
      break
    }
    const siblings = (Array.from(parent.children) as Element[]).filter((child) => child.tagName === current?.tagName)
    const suffix = siblings.length > 1 ? `:nth-of-type(${siblings.indexOf(current) + 1})` : ""
    const stableClass = Array.from(current.classList).find((className) => /^[a-zA-Z][\w-]{2,50}$/.test(className))
    parts.unshift(`${tag}${stableClass ? `.${cssEscape(stableClass)}` : ""}${suffix}`)
    current = parent
  }
  return parts.join(" > ")
}

export function buildSelector(element: Element): string {
  const segments: string[] = []
  let current = element
  while (true) {
    const root = current.getRootNode()
    if (!(root instanceof Document || root instanceof ShadowRoot)) break
    segments.unshift(uniqueSelectorWithinRoot(current, root))
    if (root instanceof Document) break
    current = root.host
  }
  return segments.join(" >>> ")
}

export function buildXpath(element: Element): string {
  const parts: string[] = []
  let current: Element | null = element
  while (current && current.nodeType === Node.ELEMENT_NODE && parts.length < 12) {
    const tag = current.tagName.toLowerCase()
    if (current.id) {
      parts.unshift(`*[@id="${current.id.replaceAll('"', "")}"]`)
      break
    }
    const parent: Element | null = current.parentElement
    const siblings = parent
      ? (Array.from(parent.children) as Element[]).filter((child) => child.tagName === current?.tagName)
      : []
    const index = siblings.length > 1 ? `[${siblings.indexOf(current) + 1}]` : ""
    parts.unshift(`${tag}${index}`)
    current = parent
  }
  return `/${parts.join("/")}`
}

function buildAncestorPath(element: Element): string {
  const parts: string[] = []
  let current: Element | null = element
  while (current && parts.length < 6) {
    const label = compactText(
      current.getAttribute("aria-label") ?? current.getAttribute("data-testid") ?? current.id ?? "",
      80,
    )
    parts.unshift(`${current.tagName.toLowerCase()}${label ? `[${label}]` : ""}`)
    current = current.parentElement
  }
  return parts.join(" > ")
}

function rectFor(element: Element): TargetRect {
  const rect = element.getBoundingClientRect()
  return {
    x: Math.round(rect.x),
    y: Math.round(rect.y),
    width: Math.round(rect.width),
    height: Math.round(rect.height),
  }
}

function styleRecord(style: CSSStyleDeclaration): Record<string, string> {
  return Object.fromEntries(
    COMPUTED_STYLE_PROPERTIES.map((property) => [property, style.getPropertyValue(property).trim()]).filter(([, value]) => value),
  )
}

function pseudoStyle(element: Element, pseudo: "::before" | "::after"): Record<string, string> | undefined {
  const style = getComputedStyle(element, pseudo)
  const content = style.getPropertyValue("content")
  if (!content || content === "none" || content === "normal") return undefined
  return styleRecord(style)
}

function sanitizedDom(element: Element): string {
  const outer = element.cloneNode(true) as Element
  const nodes = [outer, ...Array.from(outer.querySelectorAll("*"))]
  for (const node of nodes) {
    for (const attribute of Array.from(node.attributes)) {
      if (
        SENSITIVE_ATTRIBUTE_PATTERN.test(attribute.name) ||
        /(?:token|password|secret|authorization|cookie)/i.test(attribute.name) ||
        attribute.name.startsWith("on")
      ) {
        node.setAttribute(attribute.name, "[REDACTED]")
      } else {
        node.setAttribute(attribute.name, redactText(attribute.value))
      }
    }
    if (node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement) {
      node.value = ""
      node.removeAttribute("value")
    }
  }
  const parent = element.parentElement?.cloneNode(false) as Element | undefined
  if (parent) parent.append(outer)
  return truncateText(redactText((parent ?? outer).outerHTML), 24 * 1024).value
}

function matchesSafely(element: Element, selector: string): boolean {
  try {
    return element.matches(selector)
  } catch {
    return false
  }
}

function collectCssRules(element: Element): CssRuleEvidence[] {
  const output: CssRuleEvidence[] = []
  for (const sheet of Array.from(document.styleSheets)) {
    let rules: CSSRuleList
    try {
      rules = sheet.cssRules
    } catch {
      continue
    }
    for (const rule of Array.from(rules)) {
      if (!(rule instanceof CSSStyleRule) || !matchesSafely(element, rule.selectorText)) continue
      output.push({
        selector: rule.selectorText,
        cssText: truncateText(rule.style.cssText, 2_000).value,
        ...(sheet.href ? { styleSheetUrl: sheet.href } : {}),
      })
      if (output.length >= 20) return output
    }
  }
  return output
}

function ariaAttributes(element: Element): Record<string, string> {
  return Object.fromEntries(
    Array.from(element.attributes)
      .filter((attribute) => attribute.name.startsWith("aria-"))
      .slice(0, 20)
      .map((attribute) => [attribute.name, redactText(attribute.value)]),
  )
}

export function updateTargetRect(target: SelectedTarget, element: Element): SelectedTarget {
  return { ...target, rect: rectFor(element) }
}

export function collectTarget(
  element: Element,
  react?: ReactRuntimeHint,
  targetId: string = crypto.randomUUID(),
  options?: {
    rect?: TargetRect
    selectionKind?: SelectedTarget["selectionKind"]
    spacing?: TargetSpacingEvidence
    text?: string
  },
): SelectedTarget {
  const role = element.getAttribute("role")
  const text = compactText(options?.text ?? (element as HTMLElement).innerText ?? element.textContent)
  const testId = element.getAttribute("data-testid")
  const beforeStyle = pseudoStyle(element, "::before")
  const afterStyle = pseudoStyle(element, "::after")
  return {
    id: targetId,
    capturedAt: new Date().toISOString(),
    rect: options?.rect ?? rectFor(element),
    tagName: element.tagName,
    ...(role ? { role } : {}),
    ...(text ? { text } : {}),
    ...(element.id ? { idAttribute: element.id } : {}),
    classNames: Array.from(element.classList).slice(0, 30),
    ...(testId ? { testId } : {}),
    aria: ariaAttributes(element),
    selector: buildSelector(element),
    xpath: buildXpath(element),
    ancestorPath: buildAncestorPath(element),
    dom: sanitizedDom(element),
    computedStyle: styleRecord(getComputedStyle(element)),
    ...(beforeStyle ? { beforeStyle } : {}),
    ...(afterStyle ? { afterStyle } : {}),
    cssRules: collectCssRules(element),
    ...(options?.selectionKind ? { selectionKind: options.selectionKind } : {}),
    ...(options?.spacing ? { spacing: options.spacing } : {}),
    ...(react ? { react } : {}),
  }
}
