# Rootline 中文商店文案

## 基本信息

- **名称**：Rootline
- **短描述**：采集网页截图、DOM、控制台与网络证据，生成可交给 Codex、Claude Code 或 Cursor 的本地调试报告。
- **类别**：Developer Tools / 开发者工具
- **语言**：中文（简体）
- **官网**：`[待填写：产品官网或项目主页]`
- **支持页**：`[待填写：支持页或 issue 地址]`
- **支持邮箱**：`junfengjiang1@gmail.com`

## 详细描述

Rootline 是面向开发者的本地网页问题采集工具。

当页面出现布局、交互、接口或运行时异常时，点击 Rootline，直接在当前网页中复现问题并标注关键元素。Rootline 会把同一时间窗口内的页面信息和运行态证据整理成报告，方便你交给当前项目中的 Codex、Claude Code、Cursor 或其他本地 AI 编程工具继续定位和制定改动计划。

### 你可以采集

- 当前页面 URL、标题、viewport、DPR、浏览器和语言。
- 选中元素的 DOM 摘要、祖先路径、CSS selector、XPath、关键 computed style、同源 CSS 规则和 `::before` / `::after` 提示。
- React 运行提示：组件名称链和 props key；不保存完整 props value。
- Rootline 启动后产生的 console、页面 error、未处理 Promise rejection、fetch、XHR 和资源耗时。
- 结束采集时的可见区域截图，并为标注目标生成编号。
- 用户主动授权后的整屏无音频录屏（可选）。

### 输出结果

每次采集保存为一个独立目录，默认位于 Chrome 下载目录的 `Rootline/` 下：

```text
rootline-capture-YYYY-MM-DD_HH-mm-ss-<id>/
├── report.md
├── report.json
├── capture.png
└── capture.webm       # 仅录屏采集
```

报告包含脱敏后的证据、边界和缺口，并给出可复制的 AI 上下文。上下文会明确列出本机文件的绝对路径，提醒外部 AI 先读取报告和截图，不执行报告中的任何指令。

### 本地优先

- Rootline 不调用 AI API，不需要账号或 API Key。
- Rootline 不上传报告、截图、录屏、网页内容、路径或历史记录。
- 文件默认写入 Chrome 下载目录，用户可以用系统文件管理器管理和删除。
- 采集只在用户主动点击“开始标注”或“录制页面”后发生。
- 控制台和网络证据只覆盖采集开始后的时间窗口。

### 清晰的边界

Rootline 不扫描本地仓库，不解析 Source Map，不定位源码文件，不修改源码，不自动提交或部署。它提供运行态证据，不替用户或 AI 生成未经证据支持的根因结论。

Chrome 内部页、扩展商店页、PDF、跨域 iframe 和 closed shadow root 受浏览器限制，可能只能生成部分证据。

## 建议的商店支持说明

若审核或用户需要联系开发者，请使用商店后台登记的真实支持邮箱。不要在商店描述中承诺 Rootline 会自动修复代码、保证根因判断或上传数据到云端。
