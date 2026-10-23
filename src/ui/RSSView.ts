import { ItemView, WorkspaceLeaf, Notice, Modal, App, TFile, Menu, setIcon } from 'obsidian';
import { Article, Feed, getFeedDisplayName } from '../types';
import { FeedManager } from '../managers/FeedManager';
import { StorageManager } from '../managers/StorageManager';
import { formatDate, generateArticleFileName } from '../utils/helpers';
import { parseOPML, type OPMLFeed } from '../utils/opmlParser';

export const VIEW_TYPE_RSS = 'rss-view';

export class RSSView extends ItemView {
  private feedManager: FeedManager;
  private storageManager: StorageManager;
  private container!: HTMLElement;
  private articleListEl!: HTMLElement;
  private filterInput!: HTMLInputElement;
  private currentFilter = '';
  private currentFeedId = 'all';
  private statusEl?: HTMLElement;
  private filterStatusEl?: HTMLElement;
  private filterRulesEl?: HTMLElement;
  private scrollBtnsEl?: HTMLElement;
  /** 「上次看到的位置」锚点：按 ↑ 时记录当前视口顶部文章 id，刷新前也记录。
   *  ↓ 滚回此处。用文章 id 而非像素——刷新后新文章插到顶部，像素位置会漂移。 */
  private savedAnchorId: string | null = null;
  /** 跨会话兜底：上次关闭面板时的像素位置（打开面板恢复用） */
  private savedScrollTop = 0;

  constructor(leaf: WorkspaceLeaf, feedManager: FeedManager, storageManager: StorageManager) {
    super(leaf);
    this.feedManager = feedManager;
    this.storageManager = storageManager;
  }

  getViewType(): string {
    return VIEW_TYPE_RSS;
  }

  getDisplayText(): string {
    return 'RSS reader';
  }

  getIcon(): string {
    return 'rss';
  }

  async onOpen(): Promise<void> {
    await this.storageManager.load();
    await this.feedManager.reloadConfig();
    
    this.container = this.contentEl.createDiv({ cls: 'rss-container' });
    
    this.renderHeader();
    this.renderFeedSelector();
    this.renderFilter();
    this.renderFilterRules();
    this.renderArticleList();
    this.renderScrollButtons();

    // 恢复上次关闭面板时的阅读位置（2026-10-22 阿麦要求：
    // 「点向下回到上次看到的位置」——跨会话的位置也从这里恢复）
    this.savedScrollTop = this.storageManager.getSettings().articleListScrollTop || 0;
    if (this.savedScrollTop > 0) {
      this.container.scrollTop = this.savedScrollTop;
    }
  }

  async onClose(): Promise<void> {
    // 记住阅读位置，下次打开面板自动恢复。
    // 注意：滚动发生在 .rss-container（overflow-y:auto），不是 articleListEl
    try {
      await this.storageManager.updateSettings({
        articleListScrollTop: this.container?.scrollTop ?? 0,
      });
    } catch (e) {
      console.error('保存滚动位置失败：', e);
    }
  }

  private renderHeader(): void {
    const header = this.container.createDiv({ cls: 'rss-header' });

    // 左：标题 + 状态提示（如「刷新中...」），避免用户误以为按钮无反应
    const titleWrap = header.createDiv({ cls: 'rss-header-title' });
    titleWrap.createEl('h2', { text: 'RSS reader' });
    this.statusEl = titleWrap.createSpan({ cls: 'rss-status', text: '' });

    const actions = header.createDiv({ cls: 'rss-header-actions' });

    // 合并「刷新」与「重新加载」为单一按钮（2026-10-17 阿麦确认）：
    // 点刷新 = 先重读配置文件（手写的 URL/名称/分组改动即时生效）
    //        → 再拉取所有启用源的新文章 → 重渲染订阅源下拉与列表
    const refreshBtn = actions.createEl('button', { text: '刷新', cls: 'mod-cta' });
    refreshBtn.addEventListener('click', () => {
      void (async () => {
      refreshBtn.setAttribute('disabled', 'true');
      // 记录刷新前的阅读锚点（2026-10-22 阿麦要求：刷新后新文章插到顶部，
      // 点 ↓ 要能回到刷新前看到的位置。记像素会漂移，记锚点文章 id 才准）
      this.savedAnchorId = this.getTopVisibleArticleId();
      if (this.statusEl) this.statusEl.setText('刷新中...');
      try {
        // 第一步：重读配置文件（替代原「重新加载」按钮）。失败不阻断后续刷新——
        // 旧实现此处抛错会跳过 renderArticleList，导致列表停留在旧规则结果上
        // （2026-10-21 阿麦问题修复：刷新链路任何一步出错，列表都必须重新过滤渲染）。
        try {
          await this.feedManager.reloadConfig();
        } catch (e) {
          console.error('重新加载配置失败：', e);
        }
        this.renderFeedSelector();

        // 第二步：拉取新文章
        const stats = await this.feedManager.refreshAllFeeds();
        if (stats.failCount > 0) {
          new Notice(`刷新完成：新增 ${stats.newCount} 篇，${stats.failCount}/${stats.total} 个源失败（详见控制台）`, 8000);
          console.error('RSS 刷新失败的源：', stats.errors);
        } else {
          new Notice(`刷新完成：新增 ${stats.newCount} 篇`);
        }
      } catch (error) {
        console.error('刷新失败：', error);
        new Notice('刷新过程中出错，列表已按当前规则刷新', 5000);
      } finally {
        // 状态复位优先于列表渲染：渲染若抛错也不影响「刷新中...」清除与按钮解禁
        // （2026-10-22 阿麦实测：刷新完成后「刷新中」常驻不消失。旧实现把
        //  renderArticleList() 放在 setText('') 之前，渲染一抛错状态就永远清不掉）
        if (this.statusEl) this.statusEl.setText('');
        refreshBtn.removeAttribute('disabled');
        try {
          this.renderArticleList();
        } catch (e) {
          // 渲染失败的证据留档：控制台 + 通知，避免静默半渲染
          console.error('刷新后列表渲染失败：', e);
          new Notice('文章列表刷新出错，详情见控制台', 5000);
        }
      }
      })();
    });

    // 低频操作收进溢出菜单「⋯」（2026-10-22 阿麦确认：只留高频刷新在外）。
    // 菜单项全部带文字（不藏纯图标），保证可发现性。
    const moreBtn = actions.createEl('button', { cls: 'rss-more-btn', text: '⋯', attr: { title: '更多操作' } });
    moreBtn.addEventListener('click', (e) => {
      const menu = new Menu();
      menu.addItem(item => item.setTitle('添加订阅源').onClick(() => this.showAddFeedModal()));
      menu.addItem(item => item.setTitle('批量添加').onClick(() => this.showBatchAddModal()));
      menu.addItem(item => item.setTitle('导入订阅源清单').onClick(() => this.showOPMLImportModal()));
      menu.addItem(item => item.setTitle('编辑配置文件').onClick(() => {
        void this.app.workspace.openLinkText(this.feedManager.getConfigFilePath(), '');
      }));
      menu.showAtMouseEvent(e);
    });
  }

  /** 供自动刷新钩子调用：仅重渲染文章列表，不重启整个视图。 */
  public refreshView(): void {
    try {
      this.renderArticleList();
    } catch (e) {
      console.error('自动刷新后列表渲染失败：', e);
    }
  }

  private showAddFeedModal(): void {
    const categories = this.feedManager.getCategories();
    const categoryNames = Array.from(categories.keys());
    
    const modal = new AddFeedModal(this.app, categoryNames, (url, category) => {
      void (async () => {
        try {
          await this.feedManager.addFeed(url, category);
          new Notice('订阅源添加成功');
          await this.feedManager.refreshAllFeeds();
          this.renderFeedSelector();
          this.renderArticleList();
        } catch {
          new Notice('添加失败，请检查 URL 是否正确');
        }
      })();
    });
    modal.open();
  }

  private showBatchAddModal(): void {
    const categories = this.feedManager.getCategories();
    const categoryNames = Array.from(categories.keys());
    
    const modal = new BatchAddModal(this.app, categoryNames, (urls, category) => {
      void (async () => {
        try {
          const validUrls = urls.filter(u => u.trim().length > 0);
          await this.feedManager.addFeedsBatch(validUrls, category);
          new Notice(`已添加 ${validUrls.length} 个订阅源`);
          await this.feedManager.refreshAllFeeds();
          this.renderFeedSelector();
          this.renderArticleList();
        } catch {
          new Notice('批量添加失败');
        }
      })();
    });
    modal.open();
  }

  private showOPMLImportModal(): void {
    const input = createEl('input');
    input.type = 'file';
    input.accept = '.opml,.xml';
    input.addEventListener('change', () => {
      void (async () => {
      const file = input.files?.[0];
      if (!file) return;

      try {
        const content = await file.text();
        const feeds = parseOPML(content);

        if (feeds.length === 0) {
          new Notice('未找到有效的订阅源');
          return;
        }

        const modal = new OPMLConfirmModal(this.app, feeds, (selectedFeeds) => {
          void (async () => {
            let added = 0;
            for (const feed of selectedFeeds) {
              try {
                // 传入 OPML 里的名称，落盘为 `- url | 名称`（修复：旧实现丢弃名称）
                await this.feedManager.addFeed(feed.url, feed.category || '未分类', feed.title);
                added++;
              } catch {
                // skip duplicates
              }
            }
            new Notice(`已导入 ${added} 个订阅源`);
            await this.feedManager.refreshAllFeeds();
            this.renderFeedSelector();
            this.renderArticleList();
          })();
        });
        modal.open();
      } catch (error) {
        new Notice('订阅源文件解析失败');
        console.error('OPML parse error:', error);
      }
      })();
    });
    input.click();
  }

  private renderFeedSelector(): void {
    const existing = this.container.querySelector('.rss-feed-selector');
    if (existing) {
      existing.remove();
    }

    const selector = this.container.createDiv({ cls: 'rss-feed-selector' });
    selector.createSpan({ text: '订阅源:' });

    const feeds = this.feedManager.getFeeds();
    const select = selector.createEl('select');
    select.add(new Option('全部', 'all'));

    const categories = this.feedManager.getCategories();
    for (const [category, categoryFeeds] of categories) {
      const group = createEl('optgroup');
      group.label = category;
      for (const feed of categoryFeeds) {
        // 显示名优先级：customName → title → url
        const option = new Option(getFeedDisplayName(feed), feed.id);
        group.appendChild(option);
      }
      select.appendChild(group);
    }

    const uncategorized = feeds.filter(f => !f.category);
    if (uncategorized.length > 0) {
      const group = createEl('optgroup');
      group.label = '未分类';
      for (const feed of uncategorized) {
        const option = new Option(getFeedDisplayName(feed), feed.id);
        group.appendChild(option);
      }
      select.appendChild(group);
    }

    select.value = this.currentFeedId;
    select.addEventListener('change', () => {
      this.currentFeedId = select.value;
      this.updateRenameButtonState(renameBtn);
      this.renderArticleList();
    });

    // 重命名按钮：仅在选中具体订阅源（非"全部"）时可用。
    // 点击弹出 Modal，可填入自定义名（留空清除 → 回退到 title/url）。
    const renameBtn = selector.createEl('button', {
      cls: 'rss-rename-btn',
      text: '✏️ 重命名',
      attr: { title: '为当前订阅源设置显示名（留空则恢复为源标题或网址）' },
    });
    renameBtn.addEventListener('click', () => {
      if (this.currentFeedId === 'all') return;
      const feed = feeds.find(f => f.id === this.currentFeedId);
      if (!feed) return;
      this.showRenameFeedModal(feed);
    });
    this.updateRenameButtonState(renameBtn);
  }

  /** 根据"是否选中了具体订阅源"启停重命名按钮。 */
  private updateRenameButtonState(btn: HTMLButtonElement): void {
    const selected = this.currentFeedId !== 'all';
    if (selected) {
      btn.removeAttribute('disabled');
      btn.removeClass('is-disabled');
    } else {
      btn.setAttribute('disabled', 'true');
      btn.addClass('is-disabled');
    }
  }

  private showRenameFeedModal(feed: Feed): void {
    const modal = new RenameFeedModal(
      this.app,
      feed,
      getFeedDisplayName(feed),
      (name) => {
        void (async () => {
          await this.feedManager.updateFeedCustomName(feed.id, name);
          new Notice(name.trim() ? '已更新订阅源名称' : '已清除自定义名称（恢复源标题/网址）');
          this.renderFeedSelector();
          this.renderArticleList();
        })();
      }
    );
    modal.open();
  }

  private renderFilter(): void {
    const filter = this.container.createDiv({ cls: 'rss-filter' });

    // 当前生效的关键词筛选状态：规则到底生不生效，肉眼可验，
    // 避免「不知道规则生效没有」的猜测（2026-10-21 阿麦问题修复）。
    // 文本在 renderArticleList 中随每次列表渲染更新。
    this.filterStatusEl = filter.createSpan({ cls: 'rss-filter-status', text: '' });

    this.filterInput = filter.createEl('input', {
      type: 'text',
      placeholder: '搜索文章...',
    });
    
    this.filterInput.addEventListener('input', () => {
      this.currentFilter = this.filterInput.value.toLowerCase();
      this.renderArticleList();
    });
  }

  /** 更新筛选状态行文本：显示当前生效的白/黑名单与组合方式。 */
  private updateFilterStatus(): void {
    if (!this.filterStatusEl) return;
    const rules = this.storageManager.getFilterRules().filter(r => r.enabled);
    if (rules.length === 0) {
      this.filterStatusEl.setText('关键词筛选：未开启');
      return;
    }
    const inc = rules.filter(r => r.type === 'include').map(r => r.keyword);
    const exc = rules.filter(r => r.type === 'exclude').map(r => r.keyword);
    const mode = this.storageManager.getSettings().filterCombineMode || 'and';
    const parts: string[] = [];
    if (inc.length > 0) parts.push(`只显示含[${inc.join('、')}]`);
    if (exc.length > 0) parts.push(`不显示含[${exc.join('、')}]`);
    this.filterStatusEl.setText(`关键词筛选（${mode === 'or' ? '任一满足' : '同时满足'}）：${parts.join('，')}`);
  }

  /** 右侧面板内的关键词筛选管理区（2026-10-21 阿麦要求：规则调整不进设置页，
   *  在常用面板里直接完成）。含：组合方式切换、规则列表（开关/删除）、快速添加。
   *  所有操作即时生效并重渲染文章列表。 */
  private renderFilterRules(): void {
    if (this.filterRulesEl) {
      this.filterRulesEl.remove();
    }
    this.filterRulesEl = this.container.createDiv({ cls: 'rss-filter-rules' });

    // 头部：标题 + 组合方式下拉
    const head = this.filterRulesEl.createDiv({ cls: 'rss-filter-rules-head' });
    head.createSpan({ text: '关键词筛选' });
    const modeSelect = head.createEl('select', { cls: 'rss-combine-select' });
    modeSelect.add(new Option('同时满足', 'and'));
    modeSelect.add(new Option('任一满足', 'or'));
    modeSelect.value = this.storageManager.getSettings().filterCombineMode || 'and';
    modeSelect.addEventListener('change', () => {
      void (async () => {
      await this.storageManager.updateSettings({ filterCombineMode: modeSelect.value as 'and' | 'or' });
      this.renderArticleList();
      })();
    });

    // 规则列表：chip 流式布局（2026-10-22 阿麦要求：一词一行改药丸标签，
    // 词再多也自动换行，不会一词占满一整行）。实色 = 生效中，灰描边 = 已停用；
    // 点 chip 本体切换启停；× 删除；include 绿 / exclude 红。
    const rules = this.storageManager.getFilterRules();
    if (rules.length === 0) {
      this.filterRulesEl.createEl('p', { text: '暂无规则，在下方添加', cls: 'rss-rules-empty' });
    }
    const chipsWrap = this.filterRulesEl.createDiv({ cls: 'rss-chips' });
    rules.forEach(rule => {
      const chip = chipsWrap.createSpan({
        cls: `rss-chip ${rule.type === 'include' ? 'is-include' : 'is-exclude'}${rule.enabled ? '' : ' is-off'}`,
        attr: { title: rule.enabled ? '点击暂停这条规则' : '点击启用这条规则' },
      });
      chip.createSpan({ text: rule.keyword, cls: 'rss-chip-kw' });
      chip.addEventListener('click', () => {
        void (async () => {
        await this.storageManager.updateFilterRule(rule.id, { enabled: !rule.enabled });
        this.renderFilterRules();
        this.renderArticleList();
        })();
      });
      const del = chip.createSpan({
        cls: 'rss-chip-del',
        text: '×',
        attr: { title: '删除这条规则' },
      });
      del.addEventListener('click', (e) => {
        void (async () => {
        e.stopPropagation();
        await this.storageManager.deleteFilterRule(rule.id);
        this.renderFilterRules();
        this.renderArticleList();
        })();
      });
    });

    // 添加行：类型下拉 + 关键词输入 + 添加按钮
    const addRow = this.filterRulesEl.createDiv({ cls: 'rss-rule-add' });
    const typeSel = addRow.createEl('select', { cls: 'rss-rule-type-select' });
    typeSel.add(new Option('包含', 'include'));
    typeSel.add(new Option('排除', 'exclude'));
    const kwInput = addRow.createEl('input', { type: 'text', placeholder: '关键词', cls: 'rss-rule-kw-input' });
    const addBtn = addRow.createEl('button', { text: '添加', cls: 'rss-rule-add-btn' });
    const doAdd = async () => {
      const keyword = kwInput.value.trim();
      if (!keyword) {
        new Notice('请输入关键词');
        return;
      }
      await this.storageManager.addFilterRule(typeSel.value as 'include' | 'exclude', keyword);
      kwInput.value = '';
      new Notice(`已添加${typeSel.value === 'include' ? '白' : '黑'}名单规则：${keyword}`);
      this.renderFilterRules();
      this.renderArticleList();
    };
    addBtn.addEventListener('click', () => { void doAdd(); });
    kwInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') void doAdd();
    });
  }

  /** 右下角浮动按钮组（2026-10-22 阿麦要求，Obsidian 内置 lucide 图标，
   *  不依赖字符字体，换机器不失真）：
   *  ↑（chevron-up）回到顶部，点击时先把当前位置存为锚点
   *  ↓（chevron-down）回到上次看到的位置：按 ↑ 前的位置 / 刷新前的位置 /
   *    上次关闭面板时的位置 */
  private renderScrollButtons(): void {
    if (this.scrollBtnsEl) {
      this.scrollBtnsEl.remove();
    }
    this.scrollBtnsEl = this.container.createDiv({ cls: 'rss-scroll-btns' });

    const upBtn = this.scrollBtnsEl.createEl('button', {
      cls: 'rss-scroll-btn',
      attr: { title: '回到顶部' },
    });
    setIcon(upBtn, 'chevron-up');
    upBtn.addEventListener('click', () => {
      this.savedAnchorId = this.getTopVisibleArticleId();
      this.container.scrollTo({ top: 0, behavior: 'smooth' });
    });

    const downBtn = this.scrollBtnsEl.createEl('button', {
      cls: 'rss-scroll-btn',
      attr: { title: '回到上次看到的位置' },
    });
    setIcon(downBtn, 'chevron-down');
    downBtn.addEventListener('click', () => {
      // 优先回到锚点文章（按 ↑ 前的位置 / 刷新前的位置）
      if (this.savedAnchorId && this.scrollToAnchor(this.savedAnchorId)) {
        return;
      }
      // 兜底：跨会话像素位置（打开面板时恢复用）
      if (this.savedScrollTop > 0) {
        this.container.scrollTo({ top: this.savedScrollTop, behavior: 'smooth' });
        return;
      }
      new Notice('还没有可返回的位置：先向上翻一段，或点一次刷新后再试');
    });
  }

  /** 当前视口最靠上的文章 id（滚动锚点）。
   *  用文章 id 而非像素：刷新后新文章插入顶部，像素位置会漂移，锚点不会。 */
  private getTopVisibleArticleId(): string | null {
    const cards = this.articleListEl?.querySelectorAll<HTMLElement>('.rss-article-card');
    if (!cards || cards.length === 0) return null;
    const containerTop = this.container.getBoundingClientRect().top;
    for (const card of Array.from(cards)) {
      // 第一张「已进入视口」的卡片（底部越过容器顶部即算）
      if (card.getBoundingClientRect().bottom > containerTop + 4) {
        return card.dataset.articleId || null;
      }
    }
    return null;
  }

  /** 按文章 id 找卡片元素 */
  private getArticleCardEl(articleId: string): HTMLElement | null {
    const cards = this.articleListEl?.querySelectorAll<HTMLElement>('.rss-article-card');
    if (!cards) return null;
    for (const card of Array.from(cards)) {
      if (card.dataset.articleId === articleId) return card;
    }
    return null;
  }

  /** 平滑滚动到锚点文章处。文章已被清理（找不到）时返回 false。 */
  private scrollToAnchor(articleId: string): boolean {
    const card = this.getArticleCardEl(articleId);
    if (!card) return false;
    const delta = card.getBoundingClientRect().top - this.container.getBoundingClientRect().top;
    this.container.scrollTo({ top: this.container.scrollTop + delta, behavior: 'smooth' });
    return true;
  }

  private renderArticleList(): void {
    // 重渲染前记住滚动位置，渲染后恢复，避免列表闪跳。
    // 2026-10-22 修复：旧代码记的是 articleListEl.scrollTop，但真正滚动的是
    // .rss-container（overflow-y:auto），articleListEl 自身不滚动，该逻辑从未生效。
    const prevScrollTop = this.container.scrollTop;

    // 每次渲染同步筛选状态行（规则/组合方式变更后即时可见）
    this.updateFilterStatus();

    if (this.articleListEl) {
      this.articleListEl.remove();
    }

    this.articleListEl = this.container.createDiv({ cls: 'rss-article-list' });

    const articles = this.getFilteredArticles();
    const sorted = [...articles].sort(
      (a, b) => new Date(b.published).getTime() - new Date(a.published).getTime()
    );

    if (sorted.length === 0) {
      this.articleListEl.createEl('p', { text: '暂无文章，请先添加订阅源并刷新', cls: 'rss-empty' });
      return;
    }

    // 「已保存」判断批量做一次：列出保存文件夹内的现有文件集合，
    // 替代旧实现逐篇文章各查一次 vault（文章多时渲染明显变慢）
    const savedFolder = this.storageManager.getSettings().saveFolder;
    const savedFileSet = new Set<string>();
    for (const f of this.app.vault.getFiles()) {
      if (f.path.startsWith(savedFolder + '/')) {
        savedFileSet.add(f.path);
      }
    }

    sorted.forEach(article => {
      const feed = this.feedManager.getFeeds().find(f => f.id === article.feedId);
      const savedPath = this.getSavedNotePath(article, feed, savedFileSet);
      const isSaved = savedPath !== null;
      
      const articleEl = this.articleListEl.createDiv({
        cls: `rss-article-card ${article.read ? 'read' : 'unread'}`,
      });
      // 锚点 id：↓ 按钮靠它找回「上次看到的位置」（刷新前后列表内容变了也能定位）
      articleEl.dataset.articleId = article.id;
      
      articleEl.addEventListener('click', () => {
        void (async () => {
        await this.openArticle(article);
        })();
      });
      
      articleEl.createEl('h3', { text: article.title });
      const meta = articleEl.createDiv({ cls: 'rss-article-meta' });
      // 显示名优先级：customName → title → url
      meta.createSpan({ text: getFeedDisplayName(feed), cls: 'rss-feed-name' });
      meta.createSpan({ text: formatDate(article.published), cls: 'rss-date' });
      
      if (article.author) {
        meta.createSpan({ text: article.author, cls: 'rss-author' });
      }
      
      if (article.description) {
        articleEl.createEl('p', { text: article.description, cls: 'rss-description' });
      }
      
      const actions = articleEl.createDiv({ cls: 'rss-article-actions' });
      
      const readBtn = actions.createEl('button', { text: article.read ? '标为未读' : '标为已读' });
      readBtn.addEventListener('click', (e) => {
        void (async () => {
        e.stopPropagation();
        if (article.read) {
          await this.feedManager.markArticleAsUnread(article.id);
        } else {
          await this.feedManager.markArticleAsRead(article.id);
        }
        this.renderArticleList();
        })();
      });
      
      if (isSaved) {
        const openBtn = actions.createEl('button', { text: '打开笔记', cls: 'rss-btn-saved' });
        openBtn.addEventListener('click', (e) => {
          void (async () => {
          e.stopPropagation();
          await this.app.workspace.openLinkText(savedPath, '');
          })();
        });
      } else {
        const saveBtn = actions.createEl('button', { text: '保存到笔记' });
        saveBtn.addEventListener('click', (e) => {
          void (async () => {
          e.stopPropagation();
          try {
            await this.feedManager.saveArticle(article.id);
            new Notice('已保存到笔记');
            this.renderArticleList();
          } catch {
            new Notice('保存失败');
          }
          })();
        });
      }
    });

    // 恢复滚动位置（滚动容器是 .rss-container）
    this.container.scrollTop = prevScrollTop;
  }

  private getSavedNotePath(article: Article, feed?: Feed, savedFileSet?: Set<string>): string | null {
    const settings = this.storageManager.getSettings();
    const folder = settings.saveFolder;

    // 统一走 helpers.generateArticleFileName，与落盘逻辑保持同一实现
    const fileName = generateArticleFileName(settings.articleNamingTemplate, {
      title: article.title,
      published: article.published,
      author: article.author,
      feedTitle: getFeedDisplayName(feed),
    });

    const fullPath = `${folder}/${fileName}`;

    if (savedFileSet) {
      return savedFileSet.has(fullPath) ? fullPath : null;
    }

    const file = this.app.vault.getAbstractFileByPath(fullPath);
    if (file && file instanceof TFile) {
      return fullPath;
    }

    return null;
  }

  private getFilteredArticles(): Article[] {
    let articles = this.feedManager.getFilteredArticles();
    
    if (this.currentFeedId !== 'all') {
      articles = articles.filter(a => a.feedId === this.currentFeedId);
    }
    
    if (this.currentFilter) {
      articles = articles.filter(a => 
        a.title.toLowerCase().includes(this.currentFilter) ||
        (a.description || '').toLowerCase().includes(this.currentFilter)
      );
    }
    
    return articles;
  }

  private async openArticle(article: Article): Promise<void> {
    await this.feedManager.markArticleAsRead(article.id);
    // 点击文章 → 跳转原文链接（原始设计行为：浏览器新标签页打开，跟随 Obsidian 打开外部网页的习惯）
    if (article.url) {
      window.open(article.url, '_blank');
    } else {
      new Notice('该条目没有可用的原文链接');
    }
    this.renderArticleList();
  }
}

class AddFeedModal extends Modal {
  private onSubmit: (url: string, category: string) => void;
  private categories: string[];

  constructor(app: App, categories: string[], onSubmit: (url: string, category: string) => void) {
    super(app);
    this.categories = categories;
    this.onSubmit = onSubmit;
  }

  onOpen(): void {
    const { contentEl } = this;
    
    contentEl.createEl('h2', { text: '添加 RSS 订阅源' });
    
    const urlInput = contentEl.createEl('input', {
      type: 'text',
      placeholder: '输入 RSS 订阅源 URL',
      cls: 'rss-modal-field',
    });
    
    contentEl.createEl('p', { text: '分类:', cls: 'rss-modal-label' });
    
    const categorySelect = contentEl.createEl('select', { cls: 'rss-modal-select' });
    
    for (const cat of this.categories) {
      categorySelect.add(new Option(cat, cat));
    }
    categorySelect.add(new Option('新建分类...', '__new__'));
    
    const newCategoryInput = contentEl.createEl('input', {
      type: 'text',
      placeholder: '输入新分类名称',
      cls: 'rss-modal-field',
    });
    newCategoryInput.addClass('is-hidden');
    
    categorySelect.addEventListener('change', () => {
      newCategoryInput.toggleClass('is-hidden', categorySelect.value !== '__new__');
    });
    
    const btnContainer = contentEl.createDiv({ cls: 'rss-modal-actions' });

    btnContainer.createEl('button', { text: '添加' }).addEventListener('click', () => {
      const url = urlInput.value.trim();
      if (!url) {
        new Notice('请输入订阅源 URL');
        return;
      }
      const category = categorySelect.value === '__new__' 
        ? newCategoryInput.value.trim() || '未分类'
        : categorySelect.value;
      this.onSubmit(url, category);
      this.close();
    });
    
    btnContainer.createEl('button', { text: '取消' }).addEventListener('click', () => {
      this.close();
    });
    
    urlInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const url = urlInput.value.trim();
        if (url) {
          const category = categorySelect.value === '__new__' 
            ? newCategoryInput.value.trim() || '未分类'
            : categorySelect.value;
          this.onSubmit(url, category);
          this.close();
        }
      }
    });
  }
}

class BatchAddModal extends Modal {
  private onSubmit: (urls: string[], category: string) => void;
  private categories: string[];

  constructor(app: App, categories: string[], onSubmit: (urls: string[], category: string) => void) {
    super(app);
    this.categories = categories;
    this.onSubmit = onSubmit;
  }

  onOpen(): void {
    const { contentEl } = this;
    
    contentEl.createEl('h2', { text: '批量添加订阅源' });
    contentEl.createEl('p', { text: '每行一个 URL', cls: 'rss-hint' });
    
    const textarea = contentEl.createEl('textarea', {
      placeholder: 'https://example.com/feed\nhttps://another.com/rss',
      cls: 'rss-modal-textarea',
    });
    
    contentEl.createEl('p', { text: '分类:', cls: 'rss-modal-label' });
    
    const categorySelect = contentEl.createEl('select', { cls: 'rss-modal-select' });
    
    for (const cat of this.categories) {
      categorySelect.add(new Option(cat, cat));
    }
    categorySelect.add(new Option('新建分类...', '__new__'));
    
    const newCategoryInput = contentEl.createEl('input', {
      type: 'text',
      placeholder: '输入新分类名称',
      cls: 'rss-modal-field',
    });
    newCategoryInput.addClass('is-hidden');
    
    categorySelect.addEventListener('change', () => {
      newCategoryInput.toggleClass('is-hidden', categorySelect.value !== '__new__');
    });
    
    const btnContainer = contentEl.createDiv({ cls: 'rss-modal-actions' });

    btnContainer.createEl('button', { text: '批量添加' }).addEventListener('click', () => {
      const urls = textarea.value.split('\n').filter(u => u.trim().length > 0);
      if (urls.length === 0) {
        new Notice('请输入至少一个订阅源 URL');
        return;
      }
      const category = categorySelect.value === '__new__' 
        ? newCategoryInput.value.trim() || '未分类'
        : categorySelect.value;
      this.onSubmit(urls, category);
      this.close();
    });
    
    btnContainer.createEl('button', { text: '取消' }).addEventListener('click', () => {
      this.close();
    });
  }
}

class OPMLConfirmModal extends Modal {
  private feeds: OPMLFeed[];
  private onSubmit: (feeds: OPMLFeed[]) => void;
  private selectedFeeds: Set<number>;
  private importBtn?: HTMLButtonElement;
  private listContainer?: HTMLElement;

  constructor(app: App, feeds: OPMLFeed[], onSubmit: (feeds: OPMLFeed[]) => void) {
    super(app);
    this.feeds = feeds;
    this.onSubmit = onSubmit;
    this.selectedFeeds = new Set(feeds.map((_, i) => i));
  }

  onOpen(): void {
    const { contentEl } = this;

    contentEl.createEl('h2', { text: `导入订阅源清单（共 ${this.feeds.length} 个订阅源）` });

    // 修复（2026-10-21 阿麦实测反馈）：旧实现 renderFeedList 把列表重新 append 到
    // contentEl 末尾，导致底部「导入/取消」按钮被挤到列表下方、位置乱跳。
    // 现在 DOM 结构一次性固定：标题 → 全选/全不选 → 列表容器（只换内容）→ 底部按钮区。
    const toolbar = contentEl.createDiv({ cls: 'opml-toolbar' });
    const selectAllBtn = toolbar.createEl('button', { text: '全选' });
    selectAllBtn.addEventListener('click', () => {
      this.selectedFeeds = new Set(this.feeds.map((_, i) => i));
      this.renderFeedList();
      this.updateImportBtn();
    });

    const deselectAllBtn = toolbar.createEl('button', { text: '全不选' });
    deselectAllBtn.addEventListener('click', () => {
      this.selectedFeeds.clear();
      this.renderFeedList();
      this.updateImportBtn();
    });

    // 列表容器：固定位置，重渲染只替换其内容，绝不影响下方按钮区
    this.listContainer = contentEl.createDiv({ cls: 'opml-list-container' });
    this.renderFeedList();

    const footer = contentEl.createDiv({ cls: 'opml-footer' });

    this.importBtn = footer.createEl('button', { text: `导入选中的 ${this.selectedFeeds.size} 个` });
    this.importBtn.addClass('mod-cta');
    this.importBtn.addEventListener('click', () => {
      const selected = this.feeds.filter((_, i) => this.selectedFeeds.has(i));
      this.onSubmit(selected);
      this.close();
    });

    footer.createEl('button', { text: '取消' }).addEventListener('click', () => {
      this.close();
    });
  }

  /** 同步「导入选中的 N 个」按钮文字与选中数。 */
  private updateImportBtn(): void {
    if (this.importBtn) {
      this.importBtn.setText(`导入选中的 ${this.selectedFeeds.size} 个`);
    }
  }

  private renderFeedList(): void {
    if (!this.listContainer) return;
    this.listContainer.empty();

    const list = this.listContainer.createDiv({ cls: 'opml-feed-list' });

    let currentCategory = '';
    this.feeds.forEach((feed, index) => {
      if (feed.category && feed.category !== currentCategory) {
        currentCategory = feed.category;
        list.createEl('h4', { text: currentCategory, cls: 'opml-category' });
      }

      const item = list.createDiv({ cls: 'opml-feed-item' });

      const checkbox = item.createEl('input', { type: 'checkbox' });
      checkbox.checked = this.selectedFeeds.has(index);
      checkbox.addEventListener('change', () => {
        if (checkbox.checked) {
          this.selectedFeeds.add(index);
        } else {
          this.selectedFeeds.delete(index);
        }
        // 修复（2026-10-21 阿麦实测反馈）：旧实现勾选变化不更新按钮文字，
        // 取消勾选后仍显示「导入选中的 5 个」。现在每次勾选都同步。
        this.updateImportBtn();
      });

      item.createSpan({ text: feed.title, cls: 'opml-feed-title' });

      item.createSpan({ text: feed.url, cls: 'opml-feed-url' });
    });
  }
}

/** 重命名订阅源 Modal：让用户为单个订阅源设置自定义显示名。
 *  - 输入框预填当前显示名（customName 或 title 或 url）
 *  - 留空提交 = 清除自定义名，回退到源标题或网址
 *  - 显示"当前网址"和"源标题"作为参考，避免用户误以为在改源本身 */
class RenameFeedModal extends Modal {
  private feed: Feed;
  private currentDisplayName: string;
  private onSubmit: (name: string) => void;

  constructor(app: App, feed: Feed, currentDisplayName: string, onSubmit: (name: string) => void) {
    super(app);
    this.feed = feed;
    this.currentDisplayName = currentDisplayName;
    this.onSubmit = onSubmit;
  }

  onOpen(): void {
    const { contentEl } = this;

    contentEl.createEl('h2', { text: '重命名订阅源' });

    // 参考信息：原网址与源标题（来自 RSS 自身），帮助用户区分"自定义名"与"源标题"
    const info = contentEl.createDiv({ cls: 'rss-rename-info' });
    info.createDiv({ text: `网址：${this.feed.url}` });
    if (this.feed.title) {
      info.createDiv({ text: `源标题：${this.feed.title}` });
    } else {
      info.createDiv({ text: '源标题：（尚未获取，刷新后自动填充）' });
    }
    info.createDiv({ text: '当前显示：' + this.currentDisplayName });

    contentEl.createEl('p', { text: '自定义显示名（留空恢复为源标题或网址）：', cls: 'rss-modal-label' });

    const input = contentEl.createEl('input', {
      type: 'text',
      placeholder: '输入便于识别的名称，如「编程前沿」',
      cls: 'rss-modal-field',
    });
    // 预填：仅当已有 customName 时才预填，避免把 title/url 误当为"已保存的自定义名"
    if (this.feed.customName) {
      input.value = this.feed.customName;
    }
    input.focus();
    input.select();

    const btnContainer = contentEl.createDiv({ cls: 'rss-rename-actions' });
    const saveBtn = btnContainer.createEl('button', { text: '保存' });
    saveBtn.addClass('mod-cta');
    saveBtn.addEventListener('click', () => {
      this.onSubmit(input.value);
      this.close();
    });

    btnContainer.createEl('button', { text: '取消' }).addEventListener('click', () => {
      this.close();
    });

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        this.onSubmit(input.value);
        this.close();
      } else if (e.key === 'Escape') {
        this.close();
      }
    });
  }

  onClose(): void {
    this.contentEl.empty();
  }
}


