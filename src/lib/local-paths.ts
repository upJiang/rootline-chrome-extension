import { t } from "./i18n"

export function parentDirectoryPath(filename: string): string {
  const index = Math.max(filename.lastIndexOf("/"), filename.lastIndexOf("\\"))
  if (index <= 0) throw new Error(t("errorLocalPathMissing"))
  return filename.slice(0, index)
}

export function joinNativePath(root: string, child: string): string {
  const separator = root.includes("\\") && !root.includes("/") ? "\\" : "/"
  const cleanRoot = root.replace(/[\\/]+$/, "")
  const cleanChild = child.replace(/^[\\/]+/, "")
  return `${cleanRoot}${separator}${cleanChild}`
}
