# Rootline Chrome Web Store 发布材料

这套材料对应当前 `0.1.0` 构建，产品定位是：开发者在当前网页复现问题时，主动采集运行态证据，并把报告保存到本机 Chrome 下载目录。

## 文件清单

- `store-listing.zh-CN.md`：中文商店名称、短描述、详细描述和分类建议。
- `store-listing.en-US.md`：英文商店文案，可作为第二语言版本。
- `permissions-and-data.md`：Chrome Web Store Privacy 页逐项填写答案。
- `privacy-policy.md`：隐私政策正文，与项目外层 HTML 保持同步。
- `terms-of-use.md`：用户协议正文。
- `reviewer-notes.md`：审核备注、安装和复现步骤、权限解释。
- `release-checklist.md`：提交前门禁清单。
- `screenshot-captions.md`：五张商店截图的标题和说明。
- `third-party-notices.md`：运行时依赖和字体许可说明。
- `icon-128.png`：商店图标。
- `screenshots/`：五张 `1280 × 800` PNG 商店截图。
- `promo/`：可选的 `440 × 280` small promo tile 和 `1400 × 560` marquee promo tile。

项目根目录还有一份可直接部署的静态页面：

```text
/Users/mac/Desktop/AIStudy/rootline-chrome-extension/rootline-privacy-policy.html
```

它不会进入扩展 ZIP。发布前只需把其中的公开 URL 占位替换成最终页面地址，并部署到无需登录即可访问的 HTTPS 站点。以后隐私政策内容发生变化时，必须同步更新这份 HTML。

## 重新生成截图和宣传图

截图来自项目现有 E2E fixture，不是设计稿或占位图：

```bash
ROOTLINE_SCREENSHOTS=1 pnpm exec playwright test tests/e2e/extension.spec.ts
pnpm store:assets
```

`pnpm store:assets` 读取 `/tmp/rootline-*.png`，将素材输出到本目录。临时截图仍在 `/tmp`，正式提交只使用 `screenshots/` 和 `promo/` 中的文件。

## 发布前必须补充

1. 确认隐私政策中的开发者主体和联系邮箱符合商店开发者账号信息，并替换公开 URL 占位。
2. 将 `privacy-policy.md` 放到无需登录即可访问的 HTTPS 地址，并把该地址填入 Chrome Web Store Privacy 页。
3. 确认商店开发者账号、支持邮箱、官网或支持页归属真实主体。
4. 在商店后台使用 `permissions-and-data.md` 的答案完成单一用途、数据使用、远程代码和权限说明。
5. 上传 `screenshots/01-start-capture.png` 至 `05-capture-history.png`，最多选择 5 张。

Rootline 不提供云端服务，报告、截图、录屏、路径和历史索引不会上传到开发者服务器。
