import { createHash } from "node:crypto"
import { defineConfig } from "wxt"
import { resolve } from "node:path"

const chromeProfile = resolve(import.meta.dirname, ".chrome-dev-profile")
const developmentExtensionPath = resolve(import.meta.dirname, ".output/chrome-mv3-dev")
const developmentPort = Number(process.env.ROOTLINE_DEV_PORT ?? "3002")

if (!Number.isInteger(developmentPort) || developmentPort < 1 || developmentPort > 65_535) {
  throw new Error("ROOTLINE_DEV_PORT 必须是 1 到 65535 之间的整数。")
}

const developmentExtensionId = createHash("sha256")
  .update(developmentExtensionPath)
  .digest("hex")
  .slice(0, 32)
  .replace(/[0-9a-f]/g, (digit) => String.fromCharCode(97 + Number.parseInt(digit, 16)))

export default defineConfig({
  modules: ["@wxt-dev/module-react"],
  dev: {
    server: {
      port: developmentPort,
      strictPort: true,
    },
  },
  webExt: {
    disabled: process.env.ROOTLINE_MANUAL_CHROME === "1",
    ...(process.env.ROOTLINE_CHROME_PATH
      ? { binaries: { chrome: process.env.ROOTLINE_CHROME_PATH } }
      : {}),
    chromiumProfile: chromeProfile,
    keepProfileChanges: true,
    chromiumPref: {
      "extensions.pinned_extensions": [developmentExtensionId],
    },
    chromiumArgs: [
      "--proxy-bypass-list=localhost;127.0.0.1;[::1]",
      ...(process.env.ROOTLINE_OPEN_DEVTOOLS === "1" ? ["--auto-open-devtools-for-tabs"] : []),
    ],
  },
  manifest: {
    name: "Rootline",
    short_name: "Rootline",
    description: "Capture browser runtime evidence and export a local or Tencent COS debugging report.",
    version: "0.1.0",
    minimum_chrome_version: "120",
    permissions: ["activeTab", "alarms", "tabs", "scripting", "storage", "offscreen", "downloads"],
    host_permissions: ["https://*.myqcloud.com/*"],
    action: {
      default_title: "Rootline - 开始网页采集",
      default_popup: "popup.html",
      default_icon: {
        16: "icon/16.png",
        32: "icon/32.png",
      },
    },
    icons: {
      16: "icon/16.png",
      32: "icon/32.png",
      48: "icon/48.png",
      128: "icon/128.png",
    },
  },
})
