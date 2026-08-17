import { describe, expect, it } from "vitest"
import {
  isSensitiveKey,
  redactBody,
  redactHeaders,
  redactStructured,
  redactText,
  redactUrl,
  truncateText,
} from "../src/lib/redaction"

describe("redaction", () => {
  it.each(["authorization", "Cookie", "access_token", "refresh-token", "apiKey", "client_secret", "passwd", "session_id"])(
    "recognizes sensitive key %s",
    (key) => expect(isSensitiveKey(key)).toBe(true),
  )

  it("redacts query credentials and URL auth", () => {
    const result = redactUrl("https://admin:secret@example.com/api?token=abc&name=rootline&api_key=key-123")
    expect(result).not.toContain("admin")
    expect(result).not.toContain("secret")
    expect(result).not.toContain("abc")
    expect(result).not.toContain("key-123")
    expect(result).toContain("name=rootline")
  })

  it("redacts nested JSON and form bodies", () => {
    const json = redactBody(JSON.stringify({ user: { password: "pw-1", profile: { token: "tok-2", name: "Lin" } } }), "application/json")
    const form = redactBody("email=user@example.com&password=pw-3&title=hello", "application/x-www-form-urlencoded")
    expect(json).not.toContain("pw-1")
    expect(json).not.toContain("tok-2")
    expect(json).toContain("Lin")
    expect(form).not.toContain("pw-3")
    expect(form).not.toContain("user%40example.com")
    expect(form).toContain("title=hello")
  })

  it("redacts headers, inline secrets and structured arrays", () => {
    expect(redactHeaders({ Authorization: "Bearer hidden", Accept: "application/json", Cookie: "sid=hidden" })).toEqual({
      Authorization: "[REDACTED]",
      Accept: "application/json",
      Cookie: "[REDACTED]",
    })
    const text = redactText("password=visible api_key:visible2 token=console-secret set-cookie:session-secret proxy-authorization='proxy-secret'")
    expect(text).not.toContain("visible")
    expect(text).not.toContain("console-secret")
    expect(text).not.toContain("session-secret")
    expect(text).not.toContain("proxy-secret")
    expect(JSON.stringify(redactStructured([{ session_id: "visible3" }]))).not.toContain("visible3")
  })

  it("marks truncation and keeps original length", () => {
    expect(truncateText("123456", 4)).toEqual({
      value: "1234\n…[TRUNCATED 2 CHARACTERS]",
      truncated: true,
      originalLength: 6,
    })
  })
})
