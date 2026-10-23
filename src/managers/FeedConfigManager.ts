import { Vault } from 'obsidian';
import type { Feed } from '../types';
import { generateId } from '../utils/helpers';

/**
 * 订阅源「机器态」侧车文件：`.rss-reader/feeds-state.json`
 * 结构：{ [url]: { id, title, enabled } }
 *
 * 设计说明（2026-10-17 修复）：
 * - `RSS Feeds.md` 是人手写格式（`- url | 名称`），保持纯粹、不含机器态；
 * - feed.id / title / enabled 这三个「机器态」存到侧车 JSON，按 URL 关联；
 * - 修复了三个 bug：
 *   ① 旧实现每次重载都用 generateId() 生成新 id → 文章 feedId 关联断裂；
 *   ② enabled=false 持久化丢失（配置文件行没编码该状态）→ 重启后源复活；
 *   ③ title 只存内存不落盘 → 重启后显示名退化为 url。
 */

interface FeedState {
  id: string;
  title: string;
  enabled: boolean;
}

type FeedStateMap = Record<string, FeedState>;

/** 行内状态标记：第三段「| 禁用」等写法。 */
const DISABLED_WORDS = new Set(['禁用', '停用', 'disabled', 'off', 'false', '0']);
const ENABLED_WORDS = new Set(['生效', '启用', 'enabled', 'on', 'true', '1']);

export class FeedConfigManager {
  private vault: Vault;
  private configFilePath: string;
  private feeds: Feed[] = [];
  private categories: Map<string, Feed[]> = new Map();
  private state: FeedStateMap = {};
  private stateFilePath = '.rss-reader/feeds-state.json';

  constructor(vault: Vault, configFilePath: string = 'RSS Feeds.md') {
    this.vault = vault;
    this.configFilePath = configFilePath;
  }

  /** 修改配置文件路径（设置面板改动后调用），并重新加载。 */
  async setConfigFilePath(path: string): Promise<void> {
    this.configFilePath = path;
    await this.load();
  }

  async load(): Promise<void> {
    try {
      await this.loadState();

      if (!(await this.vault.adapter.exists(this.configFilePath))) {
        await this.createDefaultConfigFile();
      }

      const content = await this.vault.adapter.read(this.configFilePath);
      this.parseConfigFile(content);

      // 新发现的源（state 里没有）写回侧车，保证 id 稳定
      await this.persistState();
    } catch (error) {
      console.error('Failed to load feed config:', error);
      this.feeds = [];
      this.categories = new Map();
    }
  }

  private async loadState(): Promise<void> {
    try {
      if (await this.vault.adapter.exists(this.stateFilePath)) {
        const raw = await this.vault.adapter.read(this.stateFilePath);
        this.state = (JSON.parse(raw) as FeedStateMap) || {};
      } else {
        this.state = {};
      }
    } catch (error) {
      console.error('Failed to load feed state (sidecar), fallback to empty:', error);
      this.state = {};
    }
  }

  /** 把当前内存中的机器态（id/title/enabled）写回侧车文件。 */
  private async persistState(): Promise<void> {
    try {
      await this.vault.adapter.mkdir('.rss-reader');
    } catch {
      // 目录已存在时 mkdir 可能报错，忽略
    }
    try {
      await this.vault.adapter.write(this.stateFilePath, JSON.stringify(this.state, null, 2));
    } catch (error) {
      console.error('Failed to save feed state (sidecar):', error);
    }
  }

  private parseConfigFile(content: string): void {
    this.feeds = [];
    this.categories = new Map();

    const lines = content.split('\n');
    let currentCategory = '未分类';
    // HTML 注释块识别：`<!-- ... -->` 内的所有行都不参与解析
    // （修复：默认模板注释里的示例 URL 行会被误当真源添加）
    let inComment = false;

    for (const line of lines) {
      const trimmed = line.trim();

      if (trimmed.startsWith('<!--')) {
        inComment = true;
      }
      if (inComment) {
        if (trimmed.includes('-->')) {
          inComment = false;
        }
        continue;
      }

      if (trimmed.startsWith('## ')) {
        currentCategory = trimmed.slice(3).trim();
        continue;
      }

      if (trimmed.startsWith('# ') && !trimmed.startsWith('## ')) {
        continue;
      }

      if (trimmed === '' || trimmed.startsWith('<!--')) {
        continue;
      }

      // 支持 `- <url>`、`- <url> | <名称>`、`- <url> | <名称> | <状态>` 三种写法。
      // 状态段（2026-10-17 阿麦定）：「禁用/停用/disabled/off」= 停用；
      // 「生效/启用/on」或不写 = 启用（默认）。URL 段不允许空白与 `|`。
      const urlMatch = trimmed.match(/^[-*]\s+(https?:\/\/[^\s|]+)(.*)$/);
      if (urlMatch) {
        const url = urlMatch[1];
        // 剩余段按 `|` 拆开：状态词优先识别，第一个非状态段作为自定义名称
        const parts = (urlMatch[2] || '')
          .split('|')
          .map(s => s.trim())
          .filter(s => s.length > 0);

        let customName = '';
        let markerEnabled: boolean | null = null;
        for (const part of parts) {
          const lower = part.toLowerCase();
          if (DISABLED_WORDS.has(lower)) {
            markerEnabled = false;
          } else if (ENABLED_WORDS.has(lower)) {
            markerEnabled = true;
          } else if (!customName) {
            customName = part;
          }
        }

        // 机器态从侧车恢复 id/title；enabled 以行内标记为唯一权威：
        // 有标记按标记，无标记一律视为启用（修复：删除「禁用」标记后
        // 曾回退读取侧车上次的停用状态，导致改回 md 也不恢复）。
        const st = this.state[url];
        const enabled = markerEnabled !== null ? markerEnabled : true;
        const feed: Feed = {
          id: st?.id || generateId(),
          url,
          title: st?.title || '',
          description: '',
          enabled,
          category: currentCategory,
          customName: customName || undefined,
        };
        this.state[url] = { id: feed.id, title: feed.title, enabled: feed.enabled };
        this.feeds.push(feed);

        if (!this.categories.has(currentCategory)) {
          this.categories.set(currentCategory, []);
        }
        this.categories.get(currentCategory)!.push(feed);
      }
    }

    // 清理侧车中已不存在于配置文件的残留状态（删除行后遗留）
    const urls = new Set(this.feeds.map(f => f.url));
    for (const key of Object.keys(this.state)) {
      if (!urls.has(key)) {
        delete this.state[key];
      }
    }
  }

  async save(): Promise<void> {
    try {
      const content = this.generateConfigFile();
      await this.vault.adapter.write(this.configFilePath, content);
      await this.persistState();
    } catch (error) {
      console.error('Failed to save feed config:', error);
    }
  }

  private generateConfigFile(): string {
    const lines: string[] = ['# 我的 RSS 订阅源', ''];

    const categoryOrder = Array.from(this.categories.keys());

    for (const category of categoryOrder) {
      lines.push(`## ${category}`);
      const feeds = this.categories.get(category) || [];
      for (const feed of feeds) {
        lines.push(this.formatFeedLine(feed));
      }
      lines.push('');
    }

    const uncategorized = this.feeds.filter(f => !f.category);
    if (uncategorized.length > 0) {
      lines.push('## 未分类');
      for (const feed of uncategorized) {
        lines.push(this.formatFeedLine(feed));
      }
    }

    return lines.join('\n');
  }

  /** 将单个订阅源格式化为一行：
   *  - 启用：`- url` 或 `- url | 名称`（保持干净，状态默认省略）
   *  - 停用：`- url | 禁用` 或 `- url | 名称 | 禁用`（行内标记，用户可直接手改） */
  private formatFeedLine(feed: Feed): string {
    const name = feed.customName?.trim();
    if (!feed.enabled) {
      return name ? `- ${feed.url} | ${name} | 禁用` : `- ${feed.url} | 禁用`;
    }
    return name ? `- ${feed.url} | ${name}` : `- ${feed.url}`;
  }

  async createDefaultConfigFile(): Promise<void> {
    const defaultContent = `# 我的 RSS 订阅源

<!-- 
  在下方添加你的 RSS 订阅源，每行一个 URL
  使用 ## 标题来分组
  行尾可加状态标记：| 禁用（停用该源，不再刷新）；不加或写 | 生效 = 启用
  示例格式：
  ## 科技
  - https://example.com/feed.xml | 科技前沿
  - https://another.com/rss | 已看完的源 | 禁用
-->

## 科技
- https://www.freecodecamp.org/news/rss/

## 博客
`;
    await this.vault.adapter.write(this.configFilePath, defaultContent);
  }

  async addFeed(url: string, category: string = '未分类', customName?: string): Promise<Feed> {
    const existing = this.feeds.find(f => f.url === url);
    if (existing) {
      return existing;
    }

    const feed: Feed = {
      id: generateId(),
      url,
      title: '',
      description: '',
      enabled: true,
      category,
      // 修复（2026-10-21 阿麦实测反馈）：OPML 导入时文件里带的名称曾被丢弃，
      // 配置文件只写 `- url`。现在名称作为 customName 落盘为 `- url | 名称`。
      customName: customName?.trim() || undefined,
    };

    this.feeds.push(feed);
    this.state[url] = { id: feed.id, title: feed.title, enabled: feed.enabled };

    if (!this.categories.has(category)) {
      this.categories.set(category, []);
    }
    this.categories.get(category)!.push(feed);

    await this.save();
    return feed;
  }

  async addFeedsBatch(urls: string[], category: string = '未分类'): Promise<Feed[]> {
    const added: Feed[] = [];
    for (const url of urls) {
      const feed = await this.addFeed(url, category);
      added.push(feed);
    }
    return added;
  }

  async removeFeed(feedId: string): Promise<void> {
    const feed = this.feeds.find(f => f.id === feedId);
    if (!feed) return;

    this.feeds = this.feeds.filter(f => f.id !== feedId);
    delete this.state[feed.url];

    const category = feed.category || '未分类';
    const categoryFeeds = this.categories.get(category);
    if (categoryFeeds) {
      const updated = categoryFeeds.filter(f => f.id !== feedId);
      if (updated.length === 0) {
        this.categories.delete(category);
      } else {
        this.categories.set(category, updated);
      }
    }

    await this.save();
  }

  async toggleFeed(feedId: string): Promise<void> {
    const feed = this.feeds.find(f => f.id === feedId);
    if (feed) {
      feed.enabled = !feed.enabled;
      // 修复：enabled 状态持久化到侧车，重启后不再复活
      if (this.state[feed.url]) {
        this.state[feed.url].enabled = feed.enabled;
      }
      await this.save();
    }
  }

  /** 更新订阅源标题并持久化到侧车（修复：旧实现只改内存，重启即丢）。 */
  async updateFeedTitle(feedId: string, title: string): Promise<void> {
    const feed = this.feeds.find(f => f.id === feedId);
    if (feed) {
      feed.title = title;
      if (this.state[feed.url]) {
        this.state[feed.url].title = title;
      }
      await this.persistState();
    }
  }

  /** 设置/更新订阅源的自定义显示名。传空串或纯空白则清除（回退到 title/url）。
   *  与 updateFeedTitle 不同：customName 是用户输入，写回配置文件 md 行。 */
  async updateFeedCustomName(feedId: string, customName: string): Promise<void> {
    const feed = this.feeds.find(f => f.id === feedId);
    if (!feed) return;
    const trimmed = customName.trim();
    feed.customName = trimmed || undefined;
    await this.save();
  }

  getFeeds(): Feed[] {
    return this.feeds;
  }

  getEnabledFeeds(): Feed[] {
    return this.feeds.filter(f => f.enabled);
  }

  getCategories(): Map<string, Feed[]> {
    return this.categories;
  }

  getConfigFilePath(): string {
    return this.configFilePath;
  }
}
