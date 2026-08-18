# Rootline Agent Guide

本文件适用于 `/Users/mac/Desktop/AIStudy/rootline-chrome-extension` 整个项目。

## 隐私政策同步规则

- 项目根目录的 `rootline-privacy-policy.html` 是用于公开部署和提交 Chrome Web Store 的隐私政策页面，不得只更新 Markdown 而遗漏该 HTML。
- 任何隐私政策文案变化，都必须同步更新：
  - `rootline-privacy-policy.html`
  - `store-assets/privacy-policy.md`
- 以下代码或产品行为发生变化时，也必须检查并更新上述两份隐私政策：
  - Chrome Manifest 权限、host permissions 或远程代码使用方式。
  - 页面、DOM、样式、控制台、网络、截图或录屏的采集范围。
  - 脱敏字段、截断上限、会话保留时间和清理策略。
  - `chrome.storage`、IndexedDB、剪贴板、下载目录和历史索引的使用方式。
  - 云端服务、分析 SDK、错误上报、账号系统、AI API 或任何数据上传能力。
  - 联系邮箱、开发者主体、公开隐私政策 URL 或生效日期。
- 权限或数据处理行为变化时，还必须同步核对 `store-assets/permissions-and-data.md`，确保 Chrome Web Store 后台披露、隐私政策和实际代码行为一致。
- 更新后至少验证 HTML 能正常解析，并确认 `pnpm build` 和 `pnpm zip` 不会把开发临时文件或敏感信息加入扩展包。
