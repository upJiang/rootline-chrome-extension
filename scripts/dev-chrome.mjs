import { execFileSync, spawn } from "node:child_process"
import {
  closeSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs"
import { resolve } from "node:path"

const projectRoot = resolve(import.meta.dirname, "..")
const profileDirectory = resolve(projectRoot, ".chrome-dev-profile")
const lockPath = resolve(profileDirectory, "rootline-wxt.lock")
const chromePidPath = resolve(profileDirectory, "chrome.pid")
const wxtBinary = resolve(
  projectRoot,
  "node_modules",
  ".bin",
  process.platform === "win32" ? "wxt.cmd" : "wxt",
)
const manualChrome = process.env.ROOTLINE_MANUAL_CHROME === "1"
const developmentPort = process.env.ROOTLINE_DEV_PORT ?? "3002"
const profileArgument = `--user-data-dir=${profileDirectory}`
const developmentCacheDirectories = [
  resolve(profileDirectory, "Default", "Cache"),
  resolve(profileDirectory, "Default", "Code Cache"),
  resolve(profileDirectory, "Default", "GPUCache"),
  resolve(profileDirectory, "Default", "Service Worker", "Database"),
  resolve(profileDirectory, "Default", "Service Worker", "ScriptCache"),
  resolve(profileDirectory, "ShaderCache"),
]

mkdirSync(profileDirectory, { recursive: true })

function processIsRunning(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function readLockState() {
  try {
    const value = JSON.parse(readFileSync(lockPath, "utf8"))
    return {
      pid: Number(value.pid),
      childPid: Number(value.childPid),
      startedAt: typeof value.startedAt === "string" ? value.startedAt : undefined,
    }
  } catch {
    return { pid: Number.NaN, childPid: Number.NaN }
  }
}

function readOwnerPid() {
  const pid = readLockState().pid
  return Number.isInteger(pid) && pid > 0 ? pid : null
}

const delay = (milliseconds) => new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds))

function processCommand(pid) {
  if (process.platform === "win32") return ""
  try {
    return execFileSync("ps", ["-p", String(pid), "-o", "command="], { encoding: "utf8" }).trim()
  } catch {
    return ""
  }
}

function profileChromePids() {
  if (process.platform === "win32") {
    try {
      const pid = Number(readFileSync(chromePidPath, "utf8"))
      return processIsRunning(pid) ? [pid] : []
    } catch {
      return []
    }
  }

  let output = ""
  try {
    output = execFileSync("ps", ["-ax", "-o", "pid=,command="], { encoding: "utf8" })
  } catch {
    return []
  }

  return output
    .split("\n")
    .map((line) => line.match(/^\s*(\d+)\s+(.+)$/))
    .filter((match) => match?.[2]?.includes(profileArgument) && !match[2].includes("--type="))
    .map((match) => Number(match[1]))
    .filter((pid) => Number.isInteger(pid) && pid > 0 && pid !== process.pid)
}

function profileChromeIsRunning(pid) {
  if (!processIsRunning(pid)) return false
  if (process.platform === "win32") return true
  return processCommand(pid).includes(profileArgument)
}

async function stopProfileChrome() {
  const pids = profileChromePids()
  if (pids.length === 0) {
    try {
      unlinkSync(chromePidPath)
    } catch {
      // There is no stale browser pid file to remove.
    }
    return
  }

  for (const pid of pids) {
    try {
      process.kill(pid, "SIGTERM")
    } catch {
      // The dedicated Chrome may have exited between discovery and shutdown.
    }
  }
  for (let attempt = 0; attempt < 50 && pids.some(profileChromeIsRunning); attempt += 1) {
    await delay(100)
  }
  for (const pid of pids.filter(profileChromeIsRunning)) {
    try {
      process.kill(pid, "SIGKILL")
    } catch {
      // The process already exited.
    }
  }
  try {
    unlinkSync(chromePidPath)
  } catch {
    // Chrome Launcher may not have created a pid file yet.
  }
  console.log(`已关闭 Rootline 专用 Chrome（PID ${pids.join(", ")}）。`)
}

function clearDevelopmentCaches() {
  for (const directory of developmentCacheDirectories) {
    rmSync(directory, { recursive: true, force: true })
  }
  console.log("已清理 Rootline 专用 Chrome 的开发缓存和后台注册状态。")
}

async function stopExistingService() {
  const lock = readLockState()
  const ownerPid = Number.isInteger(lock.pid) && lock.pid > 0 ? lock.pid : null
  const childPid = Number.isInteger(lock.childPid) && lock.childPid > 0 ? lock.childPid : null
  const childCommand = childPid ? processCommand(childPid) : ""
  const childBelongsToRootline = Boolean(childPid)
    && processIsRunning(childPid)
    && (process.platform === "win32" || (childCommand.includes(projectRoot) && childCommand.includes("wxt")))

  if ((!ownerPid || !processIsRunning(ownerPid)) && !childBelongsToRootline) {
    try {
      unlinkSync(lockPath)
    } catch {
      // No active lock exists.
    }
    console.log("\n没有正在运行的 Rootline 开发服务。\n")
    return
  }

  if (ownerPid && processIsRunning(ownerPid)) process.kill(ownerPid, "SIGTERM")
  else if (childBelongsToRootline && childPid) process.kill(childPid, "SIGTERM")
  for (let attempt = 0; attempt < 50 && (
    (ownerPid ? processIsRunning(ownerPid) : false)
    || (childPid ? processIsRunning(childPid) : false)
  ); attempt += 1) {
    await delay(100)
  }
  if (childBelongsToRootline && childPid && processIsRunning(childPid)) process.kill(childPid, "SIGKILL")
  if (ownerPid && processIsRunning(ownerPid)) throw new Error(`开发服务 PID ${ownerPid} 未能在 5 秒内停止。`)
  console.log(`\n已停止 Rootline 开发服务（PID ${[ownerPid, childPid].filter(Boolean).join(", ")}）。\n`)
}

function acquireLock() {
  try {
    const descriptor = openSync(lockPath, "wx")
    writeFileSync(descriptor, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }))
    closeSync(descriptor)
    return true
  } catch (error) {
    if (error?.code !== "EEXIST") throw error
    const ownerPid = readOwnerPid()
    if (ownerPid && processIsRunning(ownerPid)) {
      console.log(`\nRootline 开发服务已在运行（PID ${ownerPid}）。`)
      console.log("直接使用已加载开发扩展的 Chrome；保存代码后会自动更新。")
      console.log(`需要接管时运行 pnpm ${manualChrome ? "dev:chrome:manual:restart" : "dev:chrome:restart"}，停止时运行 pnpm dev:chrome:stop。\n`)
      return false
    }
    unlinkSync(lockPath)
    return acquireLock()
  }
}

const command = process.argv[2]
if (command === "--stop") {
  await stopExistingService()
  await stopProfileChrome()
  process.exit(0)
}
if (command === "--restart") {
  await stopExistingService()
  if (!manualChrome) {
    await stopProfileChrome()
    clearDevelopmentCaches()
  }
} else if (!manualChrome) {
  const ownerPid = readOwnerPid()
  if (!ownerPid || !processIsRunning(ownerPid)) {
    await stopProfileChrome()
    clearDevelopmentCaches()
  }
}
if (!acquireLock()) process.exit(0)

let cleaned = false
function releaseLock() {
  if (cleaned) return
  cleaned = true
  try {
    if (readOwnerPid() === process.pid) unlinkSync(lockPath)
  } catch {
    // Stale locks are removed on the next start.
  }
}

const args = ["-b", "chrome"]
if (process.env.ROOTLINE_WXT_DEBUG === "1") args.push("--debug")

console.log(`Rootline 开发服务固定使用 http://localhost:${developmentPort}。`)

const child = spawn(wxtBinary, args, {
  cwd: projectRoot,
  env: process.env,
  stdio: "inherit",
})
writeFileSync(lockPath, JSON.stringify({
  pid: process.pid,
  childPid: child.pid,
  startedAt: new Date().toISOString(),
}))

let stopping = false

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    if (stopping) return
    stopping = true
    child.kill(signal)
    if (!manualChrome) void stopProfileChrome()
  })
}

child.on("error", (error) => {
  releaseLock()
  console.error(`无法启动 WXT：${error.message}`)
  process.exitCode = 1
})

child.on("exit", async (code, signal) => {
  if (!manualChrome) await stopProfileChrome()
  releaseLock()
  process.exitCode = code ?? (signal ? 0 : 1)
})

process.on("exit", releaseLock)
