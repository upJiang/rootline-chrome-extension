// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest"
import { buildSelector, buildXpath, collectTarget } from "../src/lib/capture/dom"

beforeEach(() => {
  document.body.innerHTML = `
    <main id="app">
      <section class="panel">
        <button class="save-button" data-testid="save-action" aria-label="保存">保存</button>
        <button class="save-button">取消</button>
      </section>
    </main>
  `
  vi.spyOn(window, "getComputedStyle").mockImplementation((() => ({
    getPropertyValue: (property: string) => property === "display" ? "inline-flex" : property === "color" ? "rgb(1, 2, 3)" : "",
  })) as unknown as typeof window.getComputedStyle)
})

describe("DOM evidence", () => {
  it("builds stable selector and XPath", () => {
    const button = document.querySelector('[data-testid="save-action"]')!
    expect(buildSelector(button)).toBe('[data-testid="save-action"]')
    expect(buildXpath(button)).toContain('*[@id="app"]')
    expect(buildXpath(button)).toContain('button')
  })

  it("collects allowlisted style and strips form values", () => {
    const input = document.createElement("input")
    input.type = "password"
    input.value = "secret-value"
    input.setAttribute("value", "secret-value")
    input.setAttribute("data-token", "raw-token")
    document.body.append(input)
    const target = collectTarget(input)
    expect(target.dom).not.toContain("secret-value")
    expect(target.dom).not.toContain("raw-token")
    expect(target.computedStyle.display).toBe("inline-flex")
    expect(target.computedStyle.color).toBe("rgb(1, 2, 3)")
    expect(target.computedStyle).not.toHaveProperty("content")
  })
})
