# Rootline

Rootline 是一个支持本地或腾讯云 COS 保存的 Chrome 网页采集扩展。默认文件保存在浏览器下载目录；用户主动选择远程模式后，文件会直接上传到用户自己的 COS。它从用户主动开始采集的时刻起记录页面运行态证据，允许选择关键 DOM 元素，并生成可直接交给 Codex、Claude Code 或 Cursor 的上下文。

Rootline 不调用模型、不向 Rootline 服务器上传报告、不扫描本地仓库、不解析 Source Map，也不修改源码。远程模式只在用户配置并主动选择后，直接向用户自己的腾讯云 COS 上传。

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
4. 本地模式点击“完成”后，Rootline 将 `report.md`、`report.json` 和 `capture.png` 写入 `Downloads/Rootline`；录屏采集还会写入 `capture.webm`。
5. 远程模式先配置腾讯云 COS，再生成内嵌截图和完整证据的 `report.html`；录屏采集还会上传同目录的 `capture.webm`，不会额外生成本地备份。
6. 完成后可以复制本地绝对路径或已生成的 COS 报告链接、查看完整证据，或从采集历史重新导出报告。复制上下文不会重复下载或上传媒体。

### 远程保存

Popup 底部切换到“远程”后会打开独立的腾讯云 COS 配置窗口。推荐使用“公有读、私有写”，不要使用“公有读写”：公有读用于让 AI 打开报告链接，私有写用于防止陌生人上传、覆盖或删除文件。Rootline 不强制创建 CAM 子用户，可以使用已有腾讯云密钥；为了降低主账号密钥泄露后的影响，仍建议创建只授权对象前缀的 CAM 子用户，并配置 `PUT`、`GET`、`HEAD`、`DELETE`、`OPTIONS` CORS。COS 凭证只保存在当前浏览器扩展的本地存储，不会发送给 Rootline；报告、截图和录屏直接上传到用户配置的 COS。公有读链接泄露后，获得链接的人可以读取报告，建议配置 7 天或 30 天生命周期。

## 权限

- `activeTab`：只在用户主动点击扩展后访问当前网页。
- `tabs`：读取当前标签页信息、向当前页发送采集消息，并按需打开完整证据页。
- `scripting`：按需注入 isolated world 桥接器与 MAIN world 运行态采集器。
- `storage`：保存活动采集和历史索引。
- `offscreen`：在不可见扩展页面中录制用户主动选择的屏幕、生成标注截图并写入本地报告。
- `alarms`：在录屏达到内部时长上限时触发统一停止和清理。
- `downloads`：将报告、截图和录屏写入 Chrome 下载目录，并读取实际绝对路径与文件状态。
- `host_permissions`（腾讯云 COS）：仅在用户选择远程保存并上传或测试连接时访问用户配置的 COS 域名。

扩展不申请 `<all_urls>`、`cookies`、`webRequest`、`debugger` 或 `desktopCapture`。默认本地模式不会发起 COS 请求。

## 采集限制

- 控制台与网络只覆盖用户主动开始采集后的事件。
- Chrome 内部页、扩展商店页和 PDF 不支持采集。
- 跨域 iframe、跨域样式表与 closed shadow root 只能记录边界，不能读取内部内容。
- 不采集 Cookie、LocalStorage、SessionStorage、表单密码、完整页面 HTML 或浏览历史。
- 采集数据先脱敏和截断，再进入存储、界面、复制内容与导出文件。
- 录屏只在用户主动选择整个屏幕后开始，固定输出 1280 × 720、16 FPS 的无音频 WebM；视频 Blob 和最多 24 个关键帧只在 IndexedDB 临时保存，成功写入本地文件或用户 COS 后即清理。

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

## Chrome Web Store 发布

商店文案、五张 `1280 × 800` 截图、宣传图、隐私政策、用户协议、权限说明、数据披露、审核备注和发布检查清单统一放在 [`store-assets/`](./store-assets/README.md)。

可直接部署的公开隐私政策页面位于 [`rootline-privacy-policy.html`](./rootline-privacy-policy.html)。隐私政策、权限或数据处理行为变化时，必须同时更新该 HTML 和 `store-assets/privacy-policy.md`。

重新生成正式商店素材：

```bash
ROOTLINE_SCREENSHOTS=1 pnpm exec playwright test tests/e2e/extension.spec.ts
pnpm store:assets
```

正式发布前必须补充真实开发者名称、支持邮箱和公开隐私政策 URL。即使 Rootline 只在本机处理数据，Chrome Web Store 仍要求处理用户数据的扩展提供公开隐私政策。
