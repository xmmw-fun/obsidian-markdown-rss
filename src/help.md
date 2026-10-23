# RSS Reader — User Manual

RSS Reader brings your favorite feeds into a side panel of Obsidian. This manual covers everything you need: adding feeds, refreshing, keyword filters, and saving articles to your vault.

## 1. Adding subscription feeds

All feeds live in a plain Markdown file (`RSS Feeds.md` in your vault root by default). You can edit it by hand at any time — the plugin reads it as the single source of truth.

Syntax:

```markdown
## Category name
- https://example.com/feed.xml | Display name
```

- A `##` heading starts a category (feeds below it belong to that category).
- Each feed is one line: a URL, optionally followed by `|` and a display name.
- Lines inside `<!-- -->` comments are ignored.

You can also add feeds from the panel: click **⋯** (top right) → **Add feed** / **Batch add** (one URL per line) / **Import OPML** (bring your subscriptions from another reader). Imports are written back to the Markdown file in the same format, so nothing is locked in a hidden database.

After editing the file by hand, just click **Refresh** in the panel — the configuration is re-read and your changes take effect immediately.

## 2. Disabling a feed

Add a marker at the end of the line:

```markdown
- https://example.com/feed.xml | Display name | 禁用
```

`禁用`, `停用`, `disabled`, or `off` all disable the feed. Any other value (or no third segment) keeps it enabled. The inline marker is the only authority: remove the marker and the feed is active again on the next refresh. Disabled feeds stay in the dropdown but are skipped when refreshing.

## 3. Refreshing

The **Refresh** button does two things: re-reads the Markdown config file, then fetches new articles from all enabled feeds. A summary notice tells you how many articles were added and whether any source failed.

## 4. Reading and position memory

- Click an article card to open the original page in your browser.
- **↑** (bottom right) scrolls back to the top — your current spot is remembered as you go.
- **↓** (bottom right) returns to where you were: the spot before you scrolled up, the article you were reading before a refresh, or your position from the last time the panel was open.

## 5. Keyword filters (whitelist / blacklist)

The filter area sits under the search box in the panel.

- **Whitelist (包含 / include)**: only show articles containing the keyword.
- **Blacklist (排除 / exclude)**: hide articles containing the keyword.
- **Match scope**: article title and summary only (not the body, not the author).
- **Combination mode**: when both lists are active, choose **AND** (both conditions) or **OR** (either condition) from the dropdown next to the section title. With only one list active, the mode makes no difference.

Each rule appears as a colored pill:

- Solid green = whitelist rule, active. Solid red = blacklist rule, active.
- Gray outline = paused. Click the pill to toggle it on or off; click **×** to delete it.

Add a rule with the row at the bottom: pick 包含/排除, type a keyword, press Enter or click **Add**.

The line above the list always shows which rules are currently in effect, so you never have to guess.

## 6. Saving articles

Click **Save to note** on any article card to save it as a Markdown file in your vault (default folder: `RSS Articles`). The file name follows the template in Settings (`{date}-{title}` by default). Saved articles show an **Open note** button instead.

## 7. Settings

Settings → RSS Reader → **Settings**:

- **General**: auto-refresh interval, max articles per feed.
- **Feeds**: open the config file, reload configuration, import OPML.
- **Keyword filters**: the same rules as the panel (changes apply instantly to an open panel).
- **User manual**: opens this document.

## 8. FAQ

**I edited the feed file but nothing changed.**
Click **Refresh** — the file is only re-read on refresh (or plugin reload).

**The list looks empty with a whitelist active.**
That is expected: a whitelist shows only matching articles. Pause or delete the rule to see everything again.

**A feed shows a web page instead of articles.**
The URL is not a real feed address. Look for an RSS/Atom link on the site (often `/feed`, `/rss`, `/atom.xml`).

**Do my feeds sync across devices?**
The feed list is a plain Markdown file and articles are stored as JSON under `.rss-reader/` in your vault — both sync with Obsidian Sync or git like any other vault content.
