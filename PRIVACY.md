# Rootline 隐私说明

Rootline v1 在本地运行，不包含账号、云端接口、统计 SDK 或 AI API。报告不会由扩展上传。

## 采集内容

- 当前页面地址、标题、origin、viewport、DPR、User-Agent、语言和采集时间。
- 用户主动选择元素的截断 DOM、关键样式、同源 CSS 规则、Selector、XPath 和有限 React 运行提示。
- 采集开始后的 console、页面 error、unhandledrejection、fetch、XHR 和 Resource Timing。
- 结束采集时的当前可见区域截图。
- 用户主动启用录屏时，由 Chrome 系统选择器授权的整个屏幕画面。录屏不包含麦克风、系统音频或摄像头。

## 不采集内容

- Cookie、LocalStorage、SessionStorage。
- 密码字段值和完整表单内容。
- 完整页面 HTML、浏览历史、麦克风、系统音频或摄像头。桌面画面仅在用户主动选择“录制页面”并确认 Chrome 整屏共享时录制。
- React props value；仅记录最多 40 个 props key。
- 跨域 iframe、跨域样式表和 closed shadow root 内部内容。

## 脱敏与限制

Rootline 在数据进入 Chrome session storage 前处理敏感 Header、URL Query、JSON、URL-encoded Form 和嵌套对象。默认隐藏 authorization、cookie、set-cookie、token、access_token、refresh_token、id_token、api_key、client_secret、password、passwd 和 session_id 等字段。

正文和事件设置固定大小与数量上限，超限内容会标记为截断或丢弃。导出前会再次执行脱敏。

## 本地存储与清理

活动会话保存在 `chrome.storage.session`，不跨浏览器重启长期保留，并会在过期后自动清理。录屏 Blob 和最多 24 个关键帧临时保存在扩展 IndexedDB，成功写入本地文件后清理。完成后的报告、JSON、标注截图和可选 `capture.webm` 自动写入 Chrome 下载目录下的 `Rootline` 子目录。Rootline 仅在 IndexedDB 保留报告历史索引和标注截图缓存，不上传这些内容。
