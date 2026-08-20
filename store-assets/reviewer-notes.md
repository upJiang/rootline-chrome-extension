# Chrome Web Store 审核备注

## 可直接粘贴的审核说明

Rootline is a local-first developer tool. It collects runtime evidence from the current HTTP/HTTPS tab only after the user explicitly clicks "开始标注" (Start annotation) or "录制页面" (Record page). Local mode requires no account, credential, backend, upload endpoint, analytics SDK, or payment. Remote mode is optional and uploads directly to a Tencent COS bucket explicitly configured by the user; the COS settings open in a separate extension popup window. Rootline has no backend and does not receive the data.

All JavaScript, CSS, fonts, and dependencies are bundled in the extension package. Rootline does not execute remote code. Captured DOM, console messages, and network responses are treated as untrusted text and are not executed.

The extension saves local-mode artifacts under the user's Chrome Downloads directory. In optional remote mode it uploads a self-contained `report.html` and optional `capture.webm` directly to the user's Tencent COS bucket. Rootline does not receive, proxy, or retain the uploaded data.

## 审核复现步骤

### 标注和截图

1. 安装扩展后打开任意普通 HTTP/HTTPS 页面，例如 `https://example.com/`。不要在 `chrome://`、Chrome Web Store 或 PDF 页面测试。
2. 点击工具栏中的 Rootline 图标。
3. 点击黑色主按钮“开始标注”。Popup 会在页面采集器回应后自动关闭。
4. 页面中出现 Rootline 浮动面板。点击“标注”或按 `A` 开始选择。
5. 点击任意页面元素，确认目标后填写“实际结果”和“预期结果”，然后点击“确定”。
6. 点击“结束并生成证据”。Rootline 会先隐藏自身浮层，再截取当前可见页面。
7. 完成面板会显示“本次证据已生成”。点击“查看本次完整证据”查看截图、元素、控制台、网络、环境和 AI 上下文。
8. 本地模式在 Chrome 下载目录的 `Rootline/` 下可以看到本次独立目录及本地文件；远程模式会显示 COS 报告链接。

### 可选录屏

1. 在普通 HTTP/HTTPS 页面打开 Rootline Popup，点击“录制页面”。
2. Chrome 显示系统级屏幕选择器。选择整个屏幕并确认共享。
3. Rootline 使用 offscreen document 和 MediaRecorder 录制 `1280 × 720`、16 FPS、无音频 WebM。
4. 在来源页点击“停止录屏并生成证据”，或先在 Popup 停止录屏，再回到来源页生成证据。
5. 完成目录会额外包含 `capture.webm`。

系统屏幕选择器需要审核人员手动确认，扩展无法自动同意或绕过该权限窗口。

## 权限审核说明

- `activeTab`：用户启动后临时访问当前网页。
- `tabs`：读取当前标签 URL/标题、保持来源标签、打开扩展内部证据页。
- `scripting`：按需注入页面桥和运行态采集器；没有常驻 content script。
- `storage`：保存活动会话、浮层位置和本地历史索引。
- `downloads`：把本地模式的报告和媒体写入 Chrome 下载目录，并读取 Chrome 返回的实际本地路径和文件状态。
- `host_permissions`：仅在用户配置并主动使用腾讯云 COS 远程模式时访问 COS。
- `offscreen`：执行用户授权的 MediaRecorder、标注截图和 Blob 本地下载。
- `alarms`：在录屏达到内部时长上限时停止录制，避免无限运行。

生产 Manifest 只包含 `https://*.myqcloud.com/*` COS host permission，不包含 `<all_urls>`、cookies、webRequest、debugger 或 desktopCapture。

## 单一用途与数据边界

Rootline 的唯一用途是：在用户主动操作后采集当前网页的运行态证据，并生成调试报告。它不自动分析根因、不修改代码、不提交、不部署，也不提供 Rootline 云端服务。远程模式只写入用户主动配置的腾讯云 COS。

已知敏感 Header、Query、JSON 和表单字段在进入存储前替换为 `[REDACTED]`。Rootline 不读取 Cookie、LocalStorage、SessionStorage、密码字段值、完整浏览历史或完整页面 HTML。

## 审核账号

不需要账号、登录信息或测试凭证。
