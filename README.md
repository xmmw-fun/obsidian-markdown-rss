<!-- 发版维护提醒：每次发版必须同步 manifest.json version + versions.json 追加一行；README 仅功能/用法变化时才需要改。 -->

# Markdown RSS

Read your favorite RSS feeds inside a clean Obsidian side panel — subscribe via a plain Markdown file, filter by keywords, and save articles straight into your vault.

## Features

- **Markdown as the feed list.** All subscriptions live in a plain-text `RSS Feeds.md` file you can edit by hand, sync with git/Obsidian Sync, and batch-edit like any other note. No hidden database.
- **Inline feed control.** Disable a feed by appending `| 禁用` to its line; remove the marker to re-enable. The file is the single source of truth.
- **OPML import.** Bring your subscriptions from any other reader, with a checklist of everything found before anything is written.
- **Keyword filters.** Whitelist (only show) and blacklist (hide) rules as compact pills, with a selectable AND/OR combination mode and a live status line showing which rules are in effect.
- **One-click saving.** Save any article as a Markdown note with a configurable file-name template.
- **Reading position memory.** Scroll-up button remembers where you were; the scroll-down button returns you to it — including across refreshes and panel reopens.
- **Works on mobile.** Pure Obsidian APIs only (no Node/Electron dependencies).

## Installation

1. Open Obsidian → Settings → Community plugins → Browse.
2. Search for **Markdown RSS** (by XMMW) and install it.
3. Click the RSS icon in the ribbon (or run the "Open feed panel" command) to open the panel.

To install a beta version manually, download `main.js`, `manifest.json`, and `styles.css` from the latest release into your vault's `.obsidian/plugins/markdown-rss/` folder.

## Usage

### Adding feeds

Edit `RSS Feeds.md` in your vault root (path configurable in settings):

```markdown
## Tech
- https://sspai.com/feed |少数派
- https://www.ruanyifeng.com/blog/atom.xml | 阮一峰的网络日志
```

A `##` heading starts a category; each feed is a line with a URL and an optional `|` display name. You can also add feeds from the panel's **⋯** menu (Add feed / Batch add / Import OPML). After hand-editing the file, click **Refresh** to apply.

### Disabling a feed

```markdown
- https://example.com/feed.xml | Example | 禁用
```

`禁用` / `停用` / `disabled` / `off` disable the feed; anything else (or no marker) keeps it enabled.

### Keyword filters

Under the search box in the panel: green pills are whitelist rules (only show matching articles), red pills are blacklist rules (hide matching articles). Click a pill to pause/resume it, `×` to delete. Choose AND/OR combination next to the section title. Matching covers the article title and summary only.

### Saving articles

Click **Save to note** on an article card; the note is written to your vault (default folder `RSS Articles`) using the `{date}-{title}` template.

### Built-in user manual

Settings → Markdown RSS → **Settings** → **User manual** opens the full manual inside Obsidian.

## Network access

This plugin fetches the feed URLs you subscribe to (via Obsidian's `requestUrl` API) and opens article links in your browser. It contains no tracking, no remote code execution, and no telemetry. Feed data is stored locally in your vault under `.rss-reader/`.

## License

MIT

---

## 中文说明

Markdown RSS 把你订阅的源汇总到 Obsidian 侧栏：订阅源清单就是一个纯文本 Markdown 文件（`RSS Feeds.md`），可手编、可同步；行尾加 `| 禁用` 即可停用某个源；支持 OPML 导入、关键词白名单/黑名单筛选（药丸式规则、可选「同时满足/任一满足」组合）、文章一键收藏为笔记，并记住你的阅读位置。完整使用手册已内置于插件：设置 → Markdown RSS → 设置 → 使用说明。
