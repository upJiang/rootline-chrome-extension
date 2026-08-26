# Product Hunt Submission

## Main info

| Field | Value |
| --- | --- |
| Name | Rootline |
| Tagline | Capture webpage evidence your AI coding agent can fix. |
| Launch URL | Use the published Chrome Web Store listing URL. |
| Tags | Developer Tools, Chrome Extensions, Artificial Intelligence |
| Open source | Leave unchecked unless the public repository is ready to share. |
| X account | Add the account that will represent this launch. |

## Description

Rootline turns hard-to-reproduce web bugs into structured evidence for developers and coding agents. Select elements, describe actual vs expected behavior, and capture annotated screenshots, console logs, network requests, and screen recordings. Export HTML, Markdown, or JSON reports with AI-ready context for Codex, Claude Code, Cursor, and teams. Rootline is local-first, with direct upload to your own Tencent COS or Alibaba OSS. No AI model calls, repository scanning, or all-sites access.

## First comment

Hi Product Hunt, I’m sharing Rootline, a Chrome extension for turning browser bugs into evidence developers can work from.

The problem is familiar: a bug report includes a URL and “this looks wrong,” but the useful context is gone by the time someone opens it. Rootline lets you select the affected elements, describe the actual and expected behavior, and capture an annotated screenshot, console logs, and network activity from the moment you start collecting. Add a screen recording when timing matters.

When you’re done, Rootline exports an HTML report, Markdown, JSON, and an AI-ready context prompt for Codex, Claude Code, Cursor, or another coding agent. The prompt points the agent to the report, asks it to inspect the repository rules, locate the root cause, make the smallest useful change, and run the relevant tests.

Privacy is a product decision. Rootline saves reports to your Chrome Downloads folder by default. If you need to share them, it uploads directly to your own Tencent COS or Alibaba OSS bucket. Rootline does not receive your reports, call an AI model, scan your repository, or require broad all-sites access.

This is an early release, and I’d love feedback on the capture workflow, report format, and the handoff to coding agents. What would make Rootline more useful in your bug-fixing process?

## Images and media

### Thumbnail

Upload this as the separate launch thumbnail:

`thumbnail/rootline-240x240.png`

Dimensions: `240 × 240` PNG, under Product Hunt’s `2 MB` limit.

### Gallery order

Upload these in this order. The files are already cropped to `1270 × 760` PNG.

1. `gallery/01-start-capture-1270x760.png`
   - Shows the starting point: reproduce an issue, annotate the page, or record the screen.
2. `gallery/02-annotate-problem-1270x760.png`
   - Shows selecting an affected element and recording actual and expected behavior.
3. `gallery/03-review-evidence-1270x760.png`
   - Shows the evidence report with DOM, console, network, and redacted request data.
4. `gallery/04-copy-ai-context-1270x760.png`
   - Shows the structured context prepared for Codex, Claude Code, Cursor, or another coding agent.
5. `gallery/05-capture-history-1270x760.png`
   - Shows the local history page for finding, opening, copying, and exporting previous captures.

The screenshots use the current product UI and contain Chinese interface text. Keep the English descriptions above as the explanation for international viewers. Do not upload the Chrome Web Store `1280 × 800` screenshots to Product Hunt unless the platform accepts that size for a specific slot.

### Video / Loom

Optional. Leave blank until there is a public YouTube or Loom URL. Do not paste a local file path or a private COS URL.

### Interactive demo

Optional. Leave blank unless a public demo URL is available. The Chrome Web Store listing is the required launch link.

## Makers

Add the maker account(s) that will answer comments on launch day. At least one active maker is recommended.

## Launch checklist

- Confirm the Chrome Web Store listing URL is public and installable.
- Upload the thumbnail first, then the five gallery images in order.
- Add the three launch tags: Developer Tools, Chrome Extensions, Artificial Intelligence.
- Paste the description and first comment without changing the product claims.
- Add a public support or product URL if available.
- Leave Video / Loom and Interactive demo empty if no public URLs exist.
- Preview the launch card and verify that the thumbnail, tagline, and first gallery image are legible.
