import { describe, expect, it } from "vitest"
import { joinNativePath, parentDirectoryPath } from "../src/lib/local-paths"

describe("local artifact paths", () => {
  it("reads POSIX and Windows parent directories from Chrome download filenames", () => {
    expect(parentDirectoryPath("/Users/mac/Downloads/Rootline/capture.png")).toBe("/Users/mac/Downloads/Rootline")
    expect(parentDirectoryPath("C:\\Users\\mac\\Downloads\\Rootline\\capture.png")).toBe("C:\\Users\\mac\\Downloads\\Rootline")
  })

  it("joins child paths with the native separator already used by the root", () => {
    expect(joinNativePath("/Users/mac/Downloads/Rootline/", "/report.md")).toBe("/Users/mac/Downloads/Rootline/report.md")
    expect(joinNativePath("C:\\Users\\mac\\Downloads\\Rootline\\", "\\report.md")).toBe("C:\\Users\\mac\\Downloads\\Rootline\\report.md")
  })
})
