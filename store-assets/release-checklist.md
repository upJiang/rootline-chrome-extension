image.png# Rootline Chrome Web Store 发布清单

## 本次自动验证结果（2026-08-20）

- [x] `pnpm typecheck`
- [x] `pnpm test`：15 个测试文件、53 个测试通过
- [x] `pnpm build`
- [x] `pnpm test:e2e`：6 个用例通过
- [x] `pnpm zip`
- [x] ZIP Manifest 只包含 `https://*.myqcloud.com/*` 和 `https://*.aliyuncs.com/*` host permission，归档内无开发 Profile、fixture、trace、商店素材、测试凭证或本机源码路径

待完成项仍包括开发者主体、公开 URL、商店后台填写、真实 Chrome 录屏确认，以及使用用户测试桶完成一次真实 COS 上传验收。

## 1. 必填主体信息

- [ ] 将隐私政策和用户协议中的 `[开发者名称]` 替换为真实个人或公司主体。
- [ ] 填写公开支持邮箱，并确认能持续收件。
- [ ] 将隐私政策发布到无需登录即可访问的 HTTPS URL。
- [ ] 在商店后台填写官网或支持页；若暂时没有官网，至少提供公开支持页。
- [ ] 核对发布地区、税务和开发者账号信息。

## 2. 商店列表

- [ ] 名称使用 `Rootline`。
- [ ] 类别选择 `Developer Tools`。
- [ ] 使用 `store-listing.zh-CN.md` 作为默认中文文案。
- [ ] 需要国际用户时增加 `store-listing.en-US.md` 本地化版本。
- [ ] 上传 `icon-128.png`。
- [ ] 按顺序上传 `screenshots/01-start-capture.png` 到 `05-capture-history.png`。
- [ ] 可选上传 `promo/small-promo-tile-440x280.png` 和 `promo/marquee-promo-tile-1400x560.png`。
- [ ] 不填写自动修复、Rootline 云端同步、源码定位、AI 根因判断等当前未实现能力；远程保存只描述为用户主动配置的腾讯云 COS 或阿里云 OSS 直传。

## 3. Privacy 页

- [ ] Single purpose 使用 `permissions-and-data.md` 中的文本。
- [ ] 逐项填写 `activeTab`、`tabs`、`scripting`、`storage`、`downloads`、`offscreen` 和 `alarms` 的理由。
- [ ] Remote code 选择 `No, I am not using remote code.`。
- [ ] 数据类别保守披露 Website content、Web history 和 User activity。
- [ ] 准确披露：本地模式不传出设备；远程模式按用户指示直传其腾讯云 COS 或阿里云 OSS；数据不发送给开发者、不出售、不用于广告、信用或无关分析。
- [ ] 填入公开隐私政策 URL。
- [ ] 确认隐私政策、商店后台披露和实际代码行为一致。

## 4. 包内容和权限

- [ ] 生产 Manifest 仅包含腾讯云 COS 和阿里云 OSS 的 `host_permissions`，不包含 `<all_urls>` 或无关 host。
- [ ] 生产 Manifest 不包含 `<all_urls>`、cookies、webRequest、debugger、desktopCapture。
- [ ] 没有远程 JavaScript、WebAssembly、`eval`、动态下载可执行代码或外部字体请求。
- [ ] 没有开发服务器地址、测试密钥、账号、Cookie、私钥或本机绝对源码路径进入 ZIP。
- [ ] `.chrome-dev-profile`、`.output/chrome-mv3-dev`、`.wxt`、trace 和 `/tmp` 截图不进入提交包。
- [ ] 版本号已按 Chrome Web Store 要求递增。
- [ ] `minimum_chrome_version` 仍为 `120`，并与兼容范围一致。

## 5. 功能验证

- [ ] 普通 HTML 页面可开始标注、选择元素、结束并保存报告。
- [ ] React 页面有运行提示；无 React 元数据时安全降级。
- [ ] 原始截图不包含 Rootline 浮层，标注截图包含目标矩形和编号。
- [ ] console、error、unhandledrejection、fetch、XHR 和资源耗时按时间窗口采集。
- [ ] Token、Authorization、Cookie 和密码不会出现在 UI 或导出文件中。
- [ ] 复制 AI 上下文不会重复下载或上传媒体；本地报告修改后只更新 Markdown 和 JSON，远程报告修改后只更新 `report.html`。
- [ ] 录屏需要系统选择器确认、不录音、停止后生成 `capture.webm`。
- [ ] Chrome 内部页、商店页和 PDF 显示明确不可采集提示。
- [ ] 断网状态仍可生成本地报告。
- [ ] 远程模式只在用户配置并主动选择后请求腾讯云 COS 或阿里云 OSS；独立配置弹窗提示“公有读、私有写”，不建议公有读写；子用户是安全建议而非强制前置条件。
- [ ] 采集历史可查看、复制和重新导出。

## 6. 自动化门禁

```bash
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
pnpm zip
```

- [ ] `typecheck` 通过。
- [ ] Vitest 全部通过。
- [ ] 生产构建通过。
- [ ] Playwright E2E 全部通过。
- [ ] ZIP 构建通过，并使用新建 Chrome Profile 手工加载验证一次。
- [ ] 录屏系统选择器在真实 Chrome 中人工验证。

## 7. 审核提交

- [ ] 把 `reviewer-notes.md` 的英文说明和复现步骤填入审核备注。
- [ ] 标注不需要测试账号。
- [ ] 说明录屏选择器必须由审核人员手动确认。
- [ ] 说明本地输出进入 Chrome Downloads，远程输出只进入用户配置的腾讯云 COS 或阿里云 OSS。
- [ ] 提交后保留本次 ZIP、版本号、商店文案和隐私政策快照，便于回滚与答复审核。

## 8. 发布后回归

- [ ] 从 Chrome Web Store 全新安装正式版本。
- [ ] 在普通网页完成一次标注截图和一次录屏采集。
- [ ] 检查下载目录、报告路径、历史、复制上下文和重新导出。
- [ ] 检查权限提示与商店披露一致。
- [ ] 记录商店版本号、发布日期、审核结果和已知限制。
