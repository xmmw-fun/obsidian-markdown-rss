import type { Feed, Article, RSSFeedItem } from '../types';
import { getFeedDisplayName } from '../types';
import { StorageManager } from './StorageManager';
import { FeedConfigManager } from './FeedConfigManager';
import { parseRSS } from '../utils/rssParser';
import { fetchFullContent, htmlToMarkdown } from '../utils/contentExtractor';

/** refreshAllFeeds 的汇总统计，用于给用户可见的刷新反馈。 */
export interface RefreshStats {
  total: number;
  newCount: number;
  failCount: number;
  errors: string[];
}

export class FeedManager {
  private storageManager: StorageManager;
  private feedConfigManager: FeedConfigManager;
  private refreshIntervalId: number | null = null;

  /** 自动刷新（定时/打开 OB）完成后回调，用于驱动已打开视图重渲染。 */
  public onAfterRefreshAll?: () => void;

  /** 筛选规则/组合方式变更后回调（设置页调用），用于驱动已打开视图立即重新过滤渲染，
   *  避免「设置改了但面板不更新」——规则变更必须即时可见（2026-10-21 阿麦问题修复）。 */
  public onFilterRulesChanged?: () => void;

  constructor(storageManager: StorageManager, feedConfigManager: FeedConfigManager) {
    this.storageManager = storageManager;
    this.feedConfigManager = feedConfigManager;
  }

  async addFeed(url: string, category: string = '未分类', customName?: string): Promise<Feed> {
    try {
      const feed = await this.feedConfigManager.addFeed(url, category, customName);
      try {
        const { feed: parsedFeed } = await parseRSS(url);
        await this.feedConfigManager.updateFeedTitle(feed.id, parsedFeed.title);
        feed.title = parsedFeed.title;
      } catch {
        feed.title = url;
      }
      return feed;
    } catch (error) {
      console.error('Failed to add feed:', error);
      throw error;
    }
  }

  async addFeedsBatch(urls: string[], category: string = '未分类'): Promise<Feed[]> {
    return await this.feedConfigManager.addFeedsBatch(urls, category);
  }

  async removeFeed(feedId: string): Promise<void> {
    await this.feedConfigManager.removeFeed(feedId);
    await this.storageManager.deleteArticlesByFeed(feedId);
  }

  async toggleFeed(feedId: string): Promise<void> {
    await this.feedConfigManager.toggleFeed(feedId);
  }

  /** 设置订阅源的自定义显示名（持久化到配置文件）；空串则清除回退到 title/url。 */
  async updateFeedCustomName(feedId: string, customName: string): Promise<void> {
    await this.feedConfigManager.updateFeedCustomName(feedId, customName);
  }

  /** 修改订阅源配置文件路径（设置面板改动后调用），并重新加载。 */
  async setConfigFilePath(path: string): Promise<void> {
    await this.feedConfigManager.setConfigFilePath(path);
  }

  async refreshFeed(feedId: string): Promise<{ added: number; error?: string }> {
    const feeds = this.feedConfigManager.getFeeds();
    const feed = feeds.find(f => f.id === feedId);

    if (!feed || !feed.enabled) {
      return { added: 0 };
    }

    try {
      const { feed: parsedFeed, items } = await parseRSS(feed.url);
      // 修复：源无标题时使用 RSS 解析出的真标题（旧实现误把 URL 当标题存入）
      if (!feed.title && parsedFeed.title) {
        await this.feedConfigManager.updateFeedTitle(feed.id, parsedFeed.title);
      }
      const added = await this.processFeedItems(feedId, items);
      return { added };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error('Failed to refresh feed:', error);
      return { added: 0, error: msg };
    }
  }

  async refreshAllFeeds(): Promise<RefreshStats> {
    const feeds = this.feedConfigManager.getEnabledFeeds();
    const stats: RefreshStats = {
      total: feeds.length,
      newCount: 0,
      failCount: 0,
      errors: [],
    };
    for (const feed of feeds) {
      const r = await this.refreshFeed(feed.id);
      stats.newCount += r.added;
      if (r.error) {
        stats.failCount++;
        // 失败提示也用显示名，便于用户识别是哪个源
        stats.errors.push(`${getFeedDisplayName(feed)}: ${r.error}`);
      }
    }
    return stats;
  }

  async processFeedItems(feedId: string, items: RSSFeedItem[]): Promise<number> {
    const existingArticles = this.storageManager.getArticles();
    const maxArticles = this.storageManager.getSettings().maxArticlesPerFeed;
    let added = 0;

    for (const item of items) {
      const existing = existingArticles.find(
        a => a.url === item.link || a.title === item.title
      );

      if (!existing) {
        const newArticle: Article = {
          id: '',
          feedId,
          title: item.title,
          url: item.link,
          description: item.contentSnippet,
          // 索引层只存截断后的内容（前 2000 字符），全文在阅读/收藏时按需抓取，
          // 避免分片 JSON 与内存被全文撑爆（对齐设计「文章索引不含正文」）
          content: item.content ? item.content.slice(0, 2000) : undefined,
          author: item.author,
          published: item.pubDate || new Date().toISOString(),
          read: false,
          starred: false,
          tags: item.categories,
        };
        await this.storageManager.addArticle(newArticle);
        added++;
      }
    }

    const feedArticles = existingArticles.filter(a => a.feedId === feedId);
    if (feedArticles.length > maxArticles) {
      const sorted = [...feedArticles].sort(
        (a, b) => new Date(b.published).getTime() - new Date(a.published).getTime()
      );
      const toDelete = sorted.slice(maxArticles);
      for (const article of toDelete) {
        await this.storageManager.deleteArticle(article.id);
      }
    }

    return added;
  }

  async markArticleAsRead(articleId: string): Promise<void> {
    await this.storageManager.updateArticle(articleId, { read: true });
  }

  async markArticleAsUnread(articleId: string): Promise<void> {
    await this.storageManager.updateArticle(articleId, { read: false });
  }

  async toggleStarred(articleId: string): Promise<void> {
    const articles = this.storageManager.getArticles();
    const article = articles.find(a => a.id === articleId);
    if (article) {
      await this.storageManager.updateArticle(articleId, { starred: !article.starred });
    }
  }

  async saveArticle(articleId: string): Promise<void> {
    const articles = this.storageManager.getArticles();
    const feeds = this.feedConfigManager.getFeeds();
    const article = articles.find(a => a.id === articleId);
    
    if (!article) {
      throw new Error('Article not found');
    }
    
    const feed = feeds.find(f => f.id === article.feedId);
    // 用显示名（customName → title → url）作为保存笔记的来源标识
    const feedTitle = getFeedDisplayName(feed);
    
    let fullContent = '';
    let extractionMethod = 'feed';

    if (article.content && article.content.trim().length > 200) {
      fullContent = htmlToMarkdown(article.content);
      extractionMethod = 'feed';
    }

    if (!fullContent || fullContent.trim().length < 100) {
      try {
        const result = await fetchFullContent(article.url);
        const extracted = htmlToMarkdown(result.content);
        
        if (extracted.trim().length > 100) {
          fullContent = extracted;
          extractionMethod = 'web';
        }
      } catch (error) {
        console.error('Failed to fetch full content:', error);
      }
    }

    if (!fullContent || fullContent.trim().length < 50) {
      fullContent = article.description || article.content || '';
      if (fullContent) {
        fullContent = htmlToMarkdown(fullContent);
      }
      extractionMethod = 'fallback';
    }

    if (extractionMethod !== 'feed' || !fullContent || fullContent.trim().length < 100) {
      fullContent = fullContent.trim() + '\n\n---\n\n> ⚠️ 正文提取不完整，请[点击查看原文](' + article.url + ')';
    }

    const articleWithContent = { ...article, content: fullContent };
    
    await this.storageManager.saveArticleToMarkdown(articleWithContent, feedTitle);
    // 注：已保存状态由 UI 按落盘文件是否存在判断，不再写 starred 死字段
  }

  getFilteredArticles(): Article[] {
    const articles = this.storageManager.getArticles();
    const rules = this.storageManager.getFilterRules().filter(r => r.enabled);

    if (rules.length === 0) {
      return articles;
    }

    const includeRules = rules.filter(r => r.type === 'include');
    const excludeRules = rules.filter(r => r.type === 'exclude');
    // 组合方式由用户在设置页选择（2026-10-21 阿麦拍板：组合关系应交予用户，
    // 而非由我们替用户定义）。默认 'and'（同时满足）。
    const combineMode = this.storageManager.getSettings().filterCombineMode || 'and';

    return articles.filter(article => {
      // 匹配范围（2026-10-21 阿麦拍板 A 方案）：只匹配标题与摘要，不匹配正文/作者
      const title = article.title.toLowerCase();
      const description = (article.description || '').toLowerCase();

      const hitInclude = includeRules.some(
        rule => title.includes(rule.keyword.toLowerCase()) || description.includes(rule.keyword.toLowerCase())
      );
      const hitExclude = excludeRules.some(
        rule => title.includes(rule.keyword.toLowerCase()) || description.includes(rule.keyword.toLowerCase())
      );

      if (combineMode === 'or') {
        // 任一满足：命中白名单 或 不被黑名单命中。
        // 仅开一种名单时退化为该名单本身的效果（与 'and' 结果一致）。
        if (includeRules.length > 0 && excludeRules.length > 0) {
          return hitInclude || !hitExclude;
        }
        if (includeRules.length > 0) {
          return hitInclude;
        }
        return !hitExclude;
      }

      // 'and' 同时满足（默认）：先过黑名单（命中即排除），再按白名单收窄
      if (hitExclude) {
        return false;
      }
      if (includeRules.length > 0) {
        return hitInclude;
      }
      return true;
    });
  }

  async reloadConfig(): Promise<void> {
    await this.feedConfigManager.load();
  }

  startAutoRefresh(): void {
    const interval = this.storageManager.getSettings().refreshInterval;
    if (this.refreshIntervalId) {
      window.clearInterval(this.refreshIntervalId);
    }
    this.refreshIntervalId = window.setInterval(() => {
      void (async () => {
        await this.refreshAllFeeds();
        this.onAfterRefreshAll?.();
      })();
    }, interval * 60 * 1000);
  }

  stopAutoRefresh(): void {
    if (this.refreshIntervalId) {
      window.clearInterval(this.refreshIntervalId);
      this.refreshIntervalId = null;
    }
  }

  getFeeds(): Feed[] {
    return this.feedConfigManager.getFeeds();
  }

  getEnabledFeeds(): Feed[] {
    return this.feedConfigManager.getEnabledFeeds();
  }

  getCategories(): Map<string, Feed[]> {
    return this.feedConfigManager.getCategories();
  }

  getArticles(): Article[] {
    return this.storageManager.getArticles();
  }

  getConfigFilePath(): string {
    return this.feedConfigManager.getConfigFilePath();
  }
}
