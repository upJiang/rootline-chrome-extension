# Chrome Web Store 权限与数据填写说明

以下内容以当前生产 Manifest 为准：

```text
activeTab
alarms
tabs
scripting
storage
offscreen
downloads
host_permissions: https://*.myqcloud.com/*
```

没有 `<all_urls>`、`optional_host_permissions`、`content_scripts`、`cookies`、`webRequest`、`debugger` 或 `desktopCapture`。腾讯云 COS host permission 只在远程模式上传时使用。

## Single purpose description

可直接填写：

> Rootline 在用户主动开始后采集当前网页的运行态证据，包括用户选择的元素、可见截图、控制台和网络事件。默认将脱敏后的调试报告保存到用户本机 Chrome 下载目录；用户主动选择远程模式后，才会直接上传到用户配置的腾讯云 COS，供 AI 编程工具读取。

英文：

> Rootline collects runtime evidence from the current webpage only after an explicit user action, including selected elements, a visible-page screenshot, console events, and network events. It saves a sanitized debugging report to the user's local Chrome Downloads directory by default, or uploads it directly to a Tencent COS bucket explicitly configured and owned by the user.

## Permission justification

### `activeTab`

> 仅在用户点击 Rootline 并主动开始采集后，临时访问当前标签页。用于注入采集器、选择元素和截取当前可见页面，不提供持续后台访问。

### `tabs`

> 读取当前标签页的 URL、标题、窗口和标签 ID；在采集、录屏和完整证据页之间切换来源标签；打开使用说明、采集历史和完整证据页。不会读取浏览历史，也不会遍历无关标签页内容。

### `scripting`

> 在用户主动开始采集后，按需向当前标签页注入 isolated world 桥接器和 MAIN world 运行态采集器。采集结束或会话失效后会移除浮层、监听器和函数包装。没有常驻 content script。

### `storage`

> 使用 `chrome.storage.session` 保存最长 24 小时的活动采集会话和当前标签索引；使用 `chrome.storage.local` 保存浮动面板位置、录屏状态和用户主动配置的腾讯云 COS 凭证。凭证只保存在当前浏览器，不会发送给 Rootline，也不会写入报告。报告历史和本地媒体缓存保存在扩展 IndexedDB，不使用同步存储。COS 配置在独立的扩展弹窗中编辑，不依赖页面内的小 Popup 表单。

### `downloads`

> 将 `report.md`、`report.json`、`capture.png` 和可选 `capture.webm` 写入 Chrome 下载目录，并读取 Chrome 返回的实际文件路径、下载状态和下载 ID，以便在报告中提供准确本地路径、打开录屏和检查文件是否可用。下载使用 `saveAs: false`。

### `host_permissions: https://*.myqcloud.com/*`

> 仅在用户主动切换到远程保存并配置腾讯云 COS 后，访问用户填写的 COS API 和公开报告地址。默认本地模式不会访问腾讯云，也不会上传数据。

### `offscreen`

> 使用不可见的扩展文档执行需要 DOM/媒体上下文的任务：接收 Chrome 屏幕选择器授权的媒体流、运行 MediaRecorder、生成标注截图和触发本地 Blob 下载；远程模式还在用户主动结束采集后执行用户配置的 COS 上传。offscreen 文档不显示广告，不在用户未操作时录制，也不会访问 Rootline 服务器。

### `alarms`

> 为录屏设置最长时长的停止闹钟，在到达内部上限时触发统一停止、保存和清理，避免录制无限持续。不会用于追踪、通知或定期联网。

## Remote code declaration

选择：

> No, I am not using remote code.

补充说明：

> Rootline bundles all JavaScript, CSS, fonts, and runtime dependencies in the extension package. It does not load or execute remote JavaScript or WebAssembly, use `eval`, or download executable code. Captured page text, DOM, logs, and network responses are treated as untrusted data and are never executed by the extension.

## Data categories

为避免低报，建议在 Chrome Web Store Privacy 页披露以下三类：

| Chrome 类别 | 选择 | 实际范围 |
| --- | --- | --- |
| Website content | Yes | 用户主动采集的当前页面截图、选中元素 DOM、样式、控制台、请求和资源信息。 |
| Web history | Yes | 只记录本次主动采集页面的 URL、标题和时间；不访问或扫描 Chrome 浏览历史。 |
| User activity | Yes | 用户选择的目标元素、标注文本和可选整屏录制。 |

其余类别不做结构化或有目的的采集：

- Personally identifiable information：不主动识别或提取；用户选择的网页截图或录屏可能附带页面中已经可见的内容，按 Website content 处理。
- Health information、Financial and payment information、Authentication information、Personal communications、Location：不主动采集。授权、Cookie、Token、API Key、密码等已知敏感字段在进入存储前脱敏；密码表单值不读取。

## Data usage answers

### 数据是否传出用户设备

> Rootline has no developer-operated backend, upload endpoint, analytics SDK, advertising SDK, account system, or AI API. In local mode, captured evidence is stored only in Chrome extension storage, IndexedDB, and the user's Chrome Downloads directory. In remote mode, the user explicitly configures a Tencent COS bucket and the extension uploads directly to that user-owned bucket; Rootline does not receive or retain the uploaded data.

### 是否出售用户数据

> No.

### 是否为与单一用途无关的目的使用或转移数据

> No.

### 是否用于信贷、借贷或资格判断

> No.

### 是否允许开发者或第三方人工读取数据

> Rootline does not transmit evidence to the developer and does not enable developer or unrelated third-party human access. When the user explicitly selects remote mode, the extension sends the report directly to the user's own Tencent COS bucket under the user's Tencent Cloud account. Tencent Cloud processes that storage under the user's agreement with Tencent Cloud. Public-read report links may be opened by anyone who receives the URL.

## Limited Use disclosure

可放在隐私政策和项目主页：

> Rootline 对用户数据的使用仅限于提供其单一用途：在用户主动操作后采集当前网页的运行态证据，并生成本地调试报告或用户自有 COS 报告。Rootline 不出售数据，不将数据用于广告、画像、信用评估或与该用途无关的分析，也不把数据传输给开发者；远程模式只按用户指示直传其腾讯云 COS。

英文：

> Rootline's use of user data is limited to its single purpose: collecting runtime evidence from the current webpage after an explicit user action and generating a local report or a report in the user's own Tencent COS bucket. Rootline does not sell data, use it for advertising, profiling, credit decisions, or unrelated analytics, or transmit it to the developer. Remote mode transfers files only to the Tencent COS bucket explicitly configured by the user.

## Privacy policy URL

Chrome 官方要求即使全部数据只保存在本机，也要提供公开隐私政策。发布前把 `privacy-policy.md` 发布到无需登录即可访问的 HTTPS 地址，然后在商店 Privacy 页填写：

```text
[待填写：公开隐私政策 URL]
```
