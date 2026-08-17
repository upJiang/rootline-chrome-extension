export function parentDirectoryPath(filename: string): string {
  const index = Math.max(filename.lastIndexOf("/"), filename.lastIndexOf("\\"))
  if (index <= 0) throw new Error("Chrome 没有返回有效的本地文件路径。")
  return filename.slice(0, index)
}

export function joinNativePath(root: string, child: string): string {
  const separator = root.includes("\\") && !root.includes("/") ? "\\" : "/"
  const cleanRoot = root.replace(/[\\/]+$/, "")
  const cleanChild = child.replace(/^[\\/]+/, "")
  return `${cleanRoot}${separator}${cleanChild}`
}
