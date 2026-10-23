import { Vault } from 'obsidian';
import type { Article, PluginSettings, FilterRule } from '../types';
import { generateId, generateArticleFileName } from '../utils/helpers';

const DEFAULT_SETTINGS: PluginSettings = {
  articles: [],
  filterRules: [],
  filterCombineMode: 'and',
  articleListScrollTop: 0,
  refreshInterval: 60,
  maxArticlesPerFeed: 50,
  saveFolder: 'RSS Articles',
  articleNamingTemplate: '{date}-{title}',
  configFilePath: 'RSS Feeds.md',
};

export class StorageManager {
  private vault: Vault;
  private settings: PluginSettings;
  private dataPath = '.rss-reader';

  constructor(vault: Vault) {
    this.vault = vault;
    this.settings = { ...DEFAULT_SETTINGS };
  }

  async load(): Promise<void> {
    try {
      const settingsFile = `${this.dataPath}/settings.json`;
      if (await this.vault.adapter.exists(settingsFile)) {
        const content = await this.vault.adapter.read(settingsFile);
        const loaded = JSON.parse(content) as PluginSettings;
        // 清理 2026-07 旧版残留的 feeds 数组（订阅源早已迁到侧车 feeds-state.json 管理，
        // 这份死数据会随每次 save 循环写回，剔除以保持 settings.json 干净）
        delete (loaded as Partial<PluginSettings> & { feeds?: unknown }).feeds;
        this.settings = { ...DEFAULT_SETTINGS, ...loaded };
        if (this.settings.filterCombineMode !== 'and' && this.settings.filterCombineMode !== 'or') {
          this.settings.filterCombineMode = 'and';
        }
      }
      
      await this.loadArticles();
    } catch (error) {
      console.error('Failed to load settings:', error);
      this.settings = { ...DEFAULT_SETTINGS };
    }
  }

  async loadArticles(): Promise<void> {
    try {
      const articlesPath = `${this.dataPath}/articles`;
      if (!(await this.vault.adapter.exists(articlesPath))) {
        return;
      }
      
      const result = await this.vault.adapter.list(articlesPath);
      this.settings.articles = [];
      
      for (const file of result.files || []) {
        if (file.endsWith('.json')) {
          const content = await this.vault.adapter.read(file);
          const article = JSON.parse(content) as Article;
          this.settings.articles.push(article);
        }
      }
    } catch (error) {
      console.error('Failed to load articles:', error);
    }
  }

  async save(): Promise<void> {
    try {
      await this.ensureDirectory(this.dataPath);
      // 修复：settings.json 只存设置，不再写入 articles 全量数组
      // （旧实现把所有文章（含全文）双份存储，settings.json 只增不减）
      // 文章本体存于 .rss-reader/articles/<id>.json 分片，内存数组仅在运行期维护
      const { articles: _omit, ...settingsOnly } = this.settings;
      const settingsContent = JSON.stringify(settingsOnly, null, 2);
      await this.vault.adapter.write(`${this.dataPath}/settings.json`, settingsContent);
    } catch (error) {
      console.error('Failed to save settings:', error);
    }
  }

  async saveArticle(article: Article): Promise<void> {
    try {
      await this.ensureDirectory(`${this.dataPath}/articles`);
      const content = JSON.stringify(article, null, 2);
      await this.vault.adapter.write(`${this.dataPath}/articles/${article.id}.json`, content);
    } catch (error) {
      console.error('Failed to save article:', error);
    }
  }

  async deleteArticle(articleId: string): Promise<void> {
    try {
      const filePath = `${this.dataPath}/articles/${articleId}.json`;
      if (await this.vault.adapter.exists(filePath)) {
        await this.vault.adapter.remove(filePath);
      }
      this.settings.articles = this.settings.articles.filter(a => a.id !== articleId);
      await this.save();
    } catch (error) {
      console.error('Failed to delete article:', error);
    }
  }

  async deleteArticlesByFeed(feedId: string): Promise<void> {
    const articlesPath = `${this.dataPath}/articles`;
    try {
      const result = await this.vault.adapter.list(articlesPath);
      for (const file of result.files || []) {
        if (file.endsWith('.json')) {
          const content = await this.vault.adapter.read(file);
          const article = JSON.parse(content) as Article;
          if (article.feedId === feedId) {
            await this.vault.adapter.remove(file);
          }
        }
      }
      this.settings.articles = this.settings.articles.filter(a => a.feedId !== feedId);
      await this.save();
    } catch (error) {
      console.error('Failed to delete articles by feed:', error);
    }
  }

  async addArticle(article: Omit<Article, 'id'>): Promise<Article> {
    const newArticle: Article = {
      ...article,
      id: generateId(),
    };
    this.settings.articles.push(newArticle);
    await this.saveArticle(newArticle);
    return newArticle;
  }

  async updateArticle(articleId: string, updates: Partial<Article>): Promise<void> {
    const article = this.settings.articles.find(a => a.id === articleId);
    if (article) {
      Object.assign(article, updates);
      await this.saveArticle(article);
    }
  }

  async addFilterRule(type: 'include' | 'exclude', keyword: string): Promise<FilterRule> {
    const rule: FilterRule = {
      id: generateId(),
      type,
      keyword,
      enabled: true,
    };
    this.settings.filterRules.push(rule);
    await this.save();
    return rule;
  }

  async deleteFilterRule(ruleId: string): Promise<void> {
    this.settings.filterRules = this.settings.filterRules.filter(r => r.id !== ruleId);
    await this.save();
  }

  async updateFilterRule(ruleId: string, updates: Partial<FilterRule>): Promise<void> {
    const rule = this.settings.filterRules.find(r => r.id === ruleId);
    if (rule) {
      Object.assign(rule, updates);
      await this.save();
    }
  }

  async updateSettings(updates: Partial<PluginSettings>): Promise<void> {
    Object.assign(this.settings, updates);
    await this.save();
  }

  async saveArticleToMarkdown(article: Article, feedTitle: string): Promise<void> {
    try {
      const folder = this.settings.saveFolder;
      await this.ensureDirectory(folder);
      
      const fileName = this.generateFileName(article, feedTitle);
      const filePath = `${folder}/${fileName}`;
      
      const frontmatter = {
        title: article.title,
        date: article.published,
        author: article.author,
        source: feedTitle,
        link: article.url,
        tags: article.tags || [],
      };
      
      const content = `---\n${JSON.stringify(frontmatter, null, 2)}\n---\n\n${article.content || article.description || ''}`;
      
      await this.vault.adapter.write(filePath, content);
    } catch (error) {
      console.error('Failed to save article to markdown:', error);
      throw error;
    }
  }

  private generateFileName(article: Article, feedTitle: string): string {
    // 统一走 helpers.generateArticleFileName，避免三处重复实现漂移
    return generateArticleFileName(this.settings.articleNamingTemplate, {
      title: article.title,
      published: article.published,
      author: article.author,
      feedTitle,
    });
  }

  private async ensureDirectory(path: string): Promise<void> {
    if (!(await this.vault.adapter.exists(path))) {
      await this.vault.adapter.mkdir(path);
    }
  }

  getArticles(): Article[] {
    return this.settings.articles;
  }

  getFilterRules(): FilterRule[] {
    return this.settings.filterRules;
  }

  getSettings(): PluginSettings {
    return this.settings;
  }
}
