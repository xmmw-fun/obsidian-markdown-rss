export interface Feed {
  id: string;
  url: string;
  title: string;
  description: string;
  icon?: string;
  lastUpdated?: string;
  refreshInterval?: number;
  enabled: boolean;
  category?: string;
  /** 用户自定义显示名。优先于 title/url 显示；为空回退 title，再回退 url。
   *  存储在配置文件 `RSS Feeds.md` 中：`- <url> | <customName>`。 */
  customName?: string;
}

/** 获取订阅源的显示名：customName → title → url。
 *  用于订阅源下拉、文章卡片的来源名称等所有展示位置，保证命名一致。 */
export function getFeedDisplayName(feed?: Feed): string {
  if (!feed) return 'Unknown';
  return feed.customName?.trim() || feed.title?.trim() || feed.url;
}

export interface Article {
  id: string;
  feedId: string;
  title: string;
  url: string;
  description?: string;
  content?: string;
  author?: string;
  published: string;
  read: boolean;
  starred: boolean;
  summary?: string;
  tags?: string[];
}

export interface FilterRule {
  id: string;
  type: 'include' | 'exclude';
  keyword: string;
  enabled: boolean;
}

export interface PluginSettings {
  articles: Article[];
  filterRules: FilterRule[];
  /** 关键词筛选的组合方式：白名单与黑名单同时开启时如何组合。
   *  - 'and'（默认，同时满足）：只显示「命中白名单 且 不被黑名单命中」的文章
   *  - 'or'（任一满足）：显示「命中白名单 或 不被黑名单命中」的文章
   *  仅开启一种名单时，此设置无影响（结果与组合方式无关）。 */
  filterCombineMode?: 'and' | 'or';
  /** 文章列表上次的滚动位置（像素）。关闭 RSS 面板时记录，重开时恢复，
   *  实现「回到上次看到的位置」（2026-10-22 阿麦要求）。 */
  articleListScrollTop?: number;
  refreshInterval: number;
  maxArticlesPerFeed: number;
  saveFolder: string;
  articleNamingTemplate: string;
  configFilePath: string;
}

export interface RSSFeedItem {
  title: string;
  link: string;
  pubDate: string;
  content?: string;
  contentSnippet?: string;
  author?: string;
  categories?: string[];
}
