# 商店截图顺序与说明

Chrome Web Store 要求至少一张 `1280 × 800` 截图，最多 5 张。当前素材均为 `1280 × 800` PNG。

## 1. `screenshots/01-start-capture.png`

- 标题：从当前页面开始采集
- 说明：用户无需配置目录或账号，可以直接选择标注截图或可选整屏录制；文件默认保存到浏览器下载目录。

## 2. `screenshots/02-annotate-problem.png`

- 标题：就地选择元素并补充预期
- 说明：在网页中选择关键元素，查看 hover 信息，并填写实际结果和预期结果。浮动面板支持拖拽、贴边折叠和重新编辑。

## 3. `screenshots/03-review-evidence.png`

- 标题：集中核对运行态证据
- 说明：完整证据页同时展示标注截图、元素、控制台、网络、环境和脱敏后的正文预览。

## 4. `screenshots/04-copy-ai-context.png`

- 标题：复制包含本地路径或 COS 链接的 AI 上下文
- 说明：本地模式上下文包含安全边界、证据缺口和本机报告/截图路径；远程模式复用已生成的 COS 报告链接，可交给 Codex、Claude Code 或 Cursor 继续定位。

## 5. `screenshots/05-capture-history.png`

- 标题：从采集历史复用结果
- 说明：历史页保留本地索引，可查看本地或远程报告、复制上下文和重新导出，不依赖 Rootline 云端服务。

## 可选宣传图

- `promo/small-promo-tile-440x280.png`
- `promo/marquee-promo-tile-1400x560.png`

宣传图只展示 Rootline 品牌和当前真实功能，不使用“自动修复”“精准根因”“零误差”等无法保证的表述。
