import { redactBody, redactHeaders, redactText, redactUrl, truncateText } from "../redaction"
import type { NetworkEvidence, SelectedTarget } from "../types"

const REQUEST_LIMIT = 8 * 1024
const RESPONSE_LIMIT = 16 * 1024
const DOM_LIMIT = 24 * 1024
const CSS_RULE_LIMIT = 2_000

function strictTextLimit(value: string, limit: number): string {
  const sanitized = redactText(value)
  if (sanitized.length <= limit) return sanitized
  const suffix = "\n…[TRUNCATED]"
  return `${sanitized.slice(0, Math.max(0, limit - suffix.length))}${suffix}`
}

function sanitizeRecord(value: Record<string, string>, limit = 500): Record<string, string> {
  return Object.fromEntries(
    Object.entries(value)
      .slice(0, 100)
      .map(([key, nested]) => [redactText(key), truncateText(redactText(String(nested)), limit).value]),
  )
}

export function sanitizeNetworkEvidence(event: NetworkEvidence): NetworkEvidence {
  const request = event.requestBody
    ? truncateText(redactBody(String(event.requestBody)) ?? "", REQUEST_LIMIT)
    : null
  const response = event.responseBody
    ? truncateText(redactBody(String(event.responseBody)) ?? "", RESPONSE_LIMIT)
    : null
  return {
    ...event,
    method: truncateText(redactText(String(event.method || "GET")).toUpperCase(), 20).value,
    url: redactUrl(String(event.url ?? "")),
    ...(event.resourceType ? { resourceType: truncateText(redactText(event.resourceType), 80).value } : {}),
    ...(redactHeaders(event.requestHeaders) ? { requestHeaders: redactHeaders(event.requestHeaders)! } : {}),
    ...(redactHeaders(event.responseHeaders) ? { responseHeaders: redactHeaders(event.responseHeaders)! } : {}),
    ...(request ? { requestBody: request.value, requestBodyTruncated: Boolean(event.requestBodyTruncated || request.truncated) } : {}),
    ...(response ? { responseBody: response.value, responseBodyTruncated: Boolean(event.responseBodyTruncated || response.truncated) } : {}),
    ...(event.error ? { error: truncateText(redactText(event.error), 1_000).value } : {}),
  }
}

export function sanitizeTargetEvidence(target: SelectedTarget): SelectedTarget {
  return {
    ...target,
    tagName: truncateText(redactText(target.tagName), 80).value,
    ...(target.role ? { role: truncateText(redactText(target.role), 120).value } : {}),
    ...(target.text ? { text: truncateText(redactText(target.text), 320).value } : {}),
    ...(target.idAttribute ? { idAttribute: truncateText(redactText(target.idAttribute), 200).value } : {}),
    classNames: target.classNames.slice(0, 30).map((item) => truncateText(redactText(item), 200).value),
    ...(target.testId ? { testId: truncateText(redactText(target.testId), 200).value } : {}),
    aria: sanitizeRecord(target.aria, 500),
    selector: truncateText(redactText(target.selector), 4_000).value,
    xpath: truncateText(redactText(target.xpath), 4_000).value,
    ancestorPath: truncateText(redactText(target.ancestorPath), 2_000).value,
    dom: truncateText(redactText(target.dom), DOM_LIMIT).value,
    computedStyle: sanitizeRecord(target.computedStyle, 2_000),
    ...(target.beforeStyle ? { beforeStyle: sanitizeRecord(target.beforeStyle, 2_000) } : {}),
    ...(target.afterStyle ? { afterStyle: sanitizeRecord(target.afterStyle, 2_000) } : {}),
    cssRules: target.cssRules.slice(0, 20).map((rule) => ({
      selector: truncateText(redactText(rule.selector), 2_000).value,
      cssText: truncateText(redactText(rule.cssText), CSS_RULE_LIMIT).value,
      ...(rule.styleSheetUrl ? { styleSheetUrl: redactUrl(rule.styleSheetUrl) } : {}),
    })),
    ...(target.selectionKind ? { selectionKind: target.selectionKind } : {}),
    ...(target.spacing ? {
      spacing: {
        axis: target.spacing.axis,
        distance: Math.max(0, Math.round(Number(target.spacing.distance) || 0)),
        from: truncateText(redactText(target.spacing.from), 320).value,
        to: truncateText(redactText(target.spacing.to), 320).value,
      },
    } : {}),
    ...(target.annotation ? {
      annotation: {
        actualResult: strictTextLimit(target.annotation.actualResult, 300),
        expectedResult: strictTextLimit(target.annotation.expectedResult, 300),
      },
    } : {}),
    ...(target.react ? {
      react: {
        available: Boolean(target.react.available),
        componentChain: target.react.componentChain.slice(0, 12).map((item) => truncateText(redactText(item), 200).value),
        propsKeys: target.react.propsKeys.slice(0, 40).map((item) => truncateText(redactText(item), 200).value),
        ...(target.react.boundary ? { boundary: truncateText(redactText(target.react.boundary), 500).value } : {}),
      },
    } : {}),
  }
}
