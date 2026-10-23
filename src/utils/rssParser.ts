import Parser from 'rss-parser';
import { requestUrl } from 'obsidian';
import type { RSSFeedItem, Feed } from '../types';

const parser = new Parser({
  customFields: {
    feed: ['description'],
    item: ['content', 'contentSnippet'],
  },
});

/** rss-parser 的 parseString 返回 any，这里显式声明消费的形状，
 *  避免 no-unsafe-* 系列 lint 错误（2026-10-22 上架整改）。 */
interface ParsedItem {
  title?: string;
  link?: string;
  pubDate?: string;
  content?: string;
  contentSnippet?: string;
  author?: string;
  categories?: string[];
}

interface ParsedFeed {
  link?: string;
  title?: string;
  description?: string;
  image?: { url?: string };
  items?: ParsedItem[];
}

export async function parseRSS(url: string): Promise<{ feed: Feed; items: RSSFeedItem[] }> {
  try {
    // 技术升级：旧实现用 rss-parser 的 parseURL()（底层 Node 原生 http，
    // 对代理/重定向/移动端兼容弱）；改为 Obsidian 官方 requestUrl 拿文本
    // 再 parseString，桌面端与移动端行为一致。
    const response = await requestUrl({ url, method: 'GET' });
    const parsed = (await parser.parseString(response.text)) as ParsedFeed;

    const feed: Feed = {
      id: parsed.link || url,
      url,
      title: parsed.title || 'Unknown Feed',
      description: parsed.description || '',
      icon: parsed.image?.url,
      enabled: true,
    };

    const items: RSSFeedItem[] = (parsed.items ?? []).map((item) => ({
      title: item.title || '',
      link: item.link || '',
      pubDate: item.pubDate || '',
      content: item.content,
      contentSnippet: item.contentSnippet,
      author: item.author ?? '',
      categories: item.categories,
    }));

    return { feed, items };
  } catch (error) {
    console.error('Failed to parse RSS:', error);
    throw error;
  }
}
