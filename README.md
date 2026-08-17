# Rootline

Rootline 是一个仅支持本地保存的 Chrome 网页采集扩展，文件默认保存在浏览器下载目录。它从用户主动开始采集的时刻起记录页面运行态证据，允许选择关键 DOM 元素，并生成可直接交给 Codex、Claude Code 或 Cursor 的本地上下文。

Rootline v1 不调用模型、不上传报告、不扫描本地仓库、不解析 Source Map，也不修改源码。

## 本地开发

要求 Node.js 20+、pnpm 11+ 和 Chrome/Chromium 120+。

```bash
pnpm install
pnpm dev:chrome
```

`dev:chrome` 使用项目内 `.chrome-dev-profile` 启动专用 Chrome，并通过 Chrome DevTools Protocol 加载 `.output/chrome-mv3-dev`。React 与 CSS 修改由 WXT 热更新，background、content script 或 manifest 修改会触发扩展重载。Rootline 固定使用 `http://localhost:3002`，避免同时开发多个 Chrome 插件时端口漂移导致 Popup 白屏。

Rootline 只管理带有当前项目 `.chrome-dev-profile` 参数的 Chrome 进程。其他插件项目的 Chrome Profile、WXT 进程和开发端口不会被停止；多个插件同时开发时，WXT 会自动选择空闲端口。

可用命令：

```bash
pnpm dev:chrome          # 启动专用调试 Chrome
pnpm dev:chrome:debug    # WXT debug 日志并打开开发者工具
pnpm dev:chrome:manual   # 只启动 WXT，手动加载扩展
pnpm dev:chrome:restart  # 关闭旧的 Rootline 专用 Chrome 并重启开发服务
pnpm dev:chrome:stop     # 停止 Rootline 开发服务并关闭其专用 Chrome
```

指定 Chrome 可执行文件：

```bash
ROOTLINE_CHROME_PATH="/path/to/chrome" pnpm dev:chrome
```

如 `3002` 已被其他服务占用，可为 Rootline 指定另一个固定端口：

```bash
ROOTLINE_DEV_PORT=3012 pnpm dev:chrome:restart
```

manual 模式在 `chrome://extensions` 开启开发者模式，加载 `.output/chrome-mv3-dev`。

## 使用流程

1. 在需要采集的 HTTP/HTTPS 页面打开 Rootline Popup，点击“开始标注”或“录制页面”。录屏会由 Chrome 打开整屏选择器，不录制音频。
2. 使用右下角工具条选择最多 10 个关键元素；点击元素后就地填写“实际表现”和“期望结果”。
3. 保存标注后继续选择；支持重编辑、撤销、清空，按 `Escape` 退出选择模式。
4. 点击“完成”，Rootline 自动将 `report.md`、`report.json` 和 `capture.png` 写入 `Downloads/Rootline`；录屏采集还会写入 `capture.webm`。
5. 文件自动保存到 Chrome 下载目录下的 `Rootline/`。采集完成后，页面面板、完整证据页和采集历史会显示本次文件的真实绝对路径。
6. 完成后可以复制包含真实绝对路径的 AI 上下文、查看完整证据，或从采集历史重新导出报告。

## 权限

- `activeTab`：只在用户主动点击扩展后访问当前网页。
- `tabs`：读取当前标签页信息、向当前页发送采集消息，并按需打开完整证据页。
- `scripting`：按需注入 isolated world 桥接器与 MAIN world 运行态采集器。
- `storage`：保存活动采集和历史索引。
- `offscreen`：在不可见扩展页面中录制用户主动选择的屏幕、生成标注截图并写入本地报告。
- `alarms`：在录屏达到内部时长上限时触发统一停止和清理。
- `downloads`：将报告、截图和录屏写入 Chrome 下载目录，并读取实际绝对路径与文件状态。

扩展不申请 `<all_urls>`、`cookies`、`webRequest`、`debugger` 或 `desktopCapture`。

## 采集限制

- 控制台与网络只覆盖用户主动开始采集后的事件。
- Chrome 内部页、扩展商店页和 PDF 不支持采集。
- 跨域 iframe、跨域样式表与 closed shadow root 只能记录边界，不能读取内部内容。
- 不采集 Cookie、LocalStorage、SessionStorage、表单密码、完整页面 HTML 或浏览历史。
- 采集数据先脱敏和截断，再进入存储、界面、复制内容与导出文件。
- 录屏只在用户主动选择整个屏幕后开始，固定输出 1280 × 720、16 FPS 的无音频 WebM；视频 Blob 和最多 24 个关键帧只在 IndexedDB 临时保存，成功写入本地文件后即清理。

详细隐私说明见 [PRIVACY.md](./PRIVACY.md)。

## 验证与打包

```bash
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
pnpm zip
```

Playwright 的截图、trace 与临时扩展副本写入 `/tmp`，不会进入仓库。
