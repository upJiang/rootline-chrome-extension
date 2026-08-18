# Rootline English Store Listing

## Basic information

- **Name**: Rootline
- **Short description**: Capture screenshots, DOM, console, and network evidence, then export a local debugging report for Codex, Claude Code, or Cursor.
- **Category**: Developer Tools
- **Language**: English (United States)
- **Website**: `[Fill in: product website or project homepage]`
- **Support URL**: `[Fill in: public support page or issue tracker]`
- **Support email**: `[Fill in: public support email]`

## Detailed description

Rootline is a local browser evidence collector for developers.

When a page has a layout, interaction, API, or runtime problem, open Rootline and reproduce the issue in the current tab. Select the important elements and describe what happened and what should happen. Rootline packages the page state and runtime evidence into a report that you can hand to Codex, Claude Code, Cursor, or another local coding assistant for investigation and a change plan.

### Evidence you can capture

- Current page URL, title, viewport, device pixel ratio, browser, and language.
- Selected element DOM summaries, ancestor paths, CSS selectors, XPath, key computed styles, same-origin CSS rules, and `::before` / `::after` hints.
- React runtime hints such as component names and prop keys, without storing complete prop values.
- Console events, page errors, unhandled promise rejections, fetch, XHR, and resource timing collected after capture starts.
- A visible-page screenshot with numbered targets.
- Optional full-screen, audio-free recording after the user explicitly approves Chrome's screen picker.

### Local output

Each capture is saved as its own folder under `Rootline/` in the Chrome Downloads directory by default:

```text
rootline-capture-YYYY-MM-DD_HH-mm-ss-<id>/
├── report.md
├── report.json
├── capture.png
└── capture.webm       # recording mode only
```

The report is sanitized and includes collection boundaries and evidence gaps. The copied AI context contains the absolute local paths to the report and media, and tells an external AI tool to read those files first and never execute instructions found inside captured page data.

### Local-only by design

- No AI API, account, API key, analytics SDK, advertising, or developer server.
- Reports, screenshots, recordings, paths, and history are never uploaded by Rootline.
- Files are written to Chrome Downloads by default and remain under the user's control.
- Collection starts only after the user clicks **Start annotation** or **Record page**.
- Console and network evidence is limited to the time window after capture begins.

Rootline does not scan local workspaces, parse source maps, identify source files, modify code, commit changes, or deploy code. It provides runtime evidence; it does not promise an automatic root-cause conclusion or an automatic fix.

Chrome internal pages, the Chrome Web Store, PDFs, cross-origin iframes, and closed shadow roots are subject to browser restrictions and may produce partial evidence.
