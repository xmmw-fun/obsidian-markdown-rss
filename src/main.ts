import { Plugin, Notice } from 'obsidian';
import { RSSView, VIEW_TYPE_RSS } from './ui/RSSView';
import { SettingsTab } from './ui/SettingsTab';
import { StorageManager } from './managers/StorageManager';
import { FeedConfigManager } from './managers/FeedConfigManager';
import { FeedManager } from './managers/FeedManager';
import { parseOPML } from './utils/opmlParser';

export default class RSSReaderPlugin extends Plugin {
  private storageManager!: StorageManager;
  private feedConfigManager!: FeedConfigManager;
  private feedManager!: FeedManager;

  async onload(): Promise<void> {
    await this.initManagers();
    
    this.registerView(
      VIEW_TYPE_RSS,
      (leaf) => new RSSView(leaf, this.feedManager, this.storageManager)
    );
    
    this.addRibbonIcon('rss', 'RSS reader', () => {
      void this.openRSSView();
    });
    
    this.addCommand({
      id: 'open-rss-view',
      name: '打开订阅面板',
      callback: () => {
        void this.openRSSView();
      },
    });
    
    this.addCommand({
      id: 'refresh-all-feeds',
      name: '刷新所有订阅源',
      callback: async () => {
        const stats = await this.feedManager.refreshAllFeeds();
        if (stats.failCount > 0) {
          new Notice(`刷新完成：新增 ${stats.newCount} 篇，${stats.failCount}/${stats.total} 个源失败（详见控制台）`, 8000);
          console.error('RSS 刷新失败的源：', stats.errors);
        } else {
          new Notice(`刷新完成：新增 ${stats.newCount} 篇`);
        }
      },
    });

    this.addCommand({
      id: 'reload-feed-config',
      name: '重新加载订阅源配置',
      callback: async () => {
        await this.feedManager.reloadConfig();
        new Notice('配置已重新加载');
      },
    });

    this.addCommand({
      id: 'import-opml',
      name: '导入订阅源清单',
      callback: () => {
        this.importOPML();
      },
    });
    
    this.addSettingTab(new SettingsTab(this.app, this, this.feedManager, this.storageManager));
    
    // 自动刷新定时器完成后，若 RSS 视图已打开则重渲染（避免面板停留在旧数据）
    this.feedManager.onAfterRefreshAll = () => {
      this.refreshOpenViews();
    };

    // 筛选规则/组合方式变更后（设置页操作），已打开的 RSS 面板立即重新过滤渲染，
    // 修复「设置改了但面板不更新」——规则变更必须即时可见（2026-10-21 阿麦问题修复）
    this.feedManager.onFilterRulesChanged = () => {
      this.refreshOpenViews();
    };
    
    this.feedManager.startAutoRefresh();
    
    // 每次打开 Obsidian 自动刷新一次订阅源（含自动刷新 Hook 完成后重渲染）
    this.app.workspace.onLayoutReady(async () => {
      try {
        new Notice('RSS 正在自动刷新…');
        const stats = await this.feedManager.refreshAllFeeds();
        this.feedManager.onAfterRefreshAll?.();
        if (stats.failCount > 0) {
          new Notice(`RSS 自动刷新完成：新增 ${stats.newCount} 篇，${stats.failCount}/${stats.total} 个源失败（详见控制台）`, 8000);
          console.error('RSS 自动刷新失败的源：', stats.errors);
        } else {
          new Notice(`RSS 自动刷新完成：新增 ${stats.newCount} 篇`);
        }
      } catch (e) {
        console.error('打开时自动刷新失败：', e);
        new Notice('RSS 自动刷新失败，请手动刷新');
      }
    });
  }

  onunload(): void {
    // 注意：不要在这里 detachLeavesOfType——会重置用户摆放的面板位置
    // （obsidianmd/detach-leaves 规则，019 实战教训）
    this.feedManager.stopAutoRefresh();
  }

  private async initManagers(): Promise<void> {
    this.storageManager = new StorageManager(this.app.vault);
    await this.storageManager.load();
    
    this.feedConfigManager = new FeedConfigManager(
      this.app.vault,
      this.storageManager.getSettings().configFilePath
    );
    await this.feedConfigManager.load();
    
    this.feedManager = new FeedManager(this.storageManager, this.feedConfigManager);
  }

  /** 重渲染所有已打开的 RSS 视图（自动刷新完成/筛选规则变更时调用）。 */
  private refreshOpenViews(): void {
    const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_RSS);
    for (const leaf of leaves) {
      const view = leaf.view;
      if (view instanceof RSSView) view.refreshView();
    }
  }

  private async openRSSView(): Promise<void> {
    if (this.app.workspace.getLeavesOfType(VIEW_TYPE_RSS).length === 0) {
      const leaf = this.app.workspace.getRightLeaf(false);
      if (leaf) {
        await leaf.setViewState({
          type: VIEW_TYPE_RSS,
        });
      }
    }
    const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_RSS);
    if (leaves.length > 0) {
      await this.app.workspace.revealLeaf(leaves[0]);
    }
  }

  private importOPML(): void {
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

        let added = 0;
        for (const feed of feeds) {
          try {
            // 传入 OPML 里的名称，落盘为 `- url | 名称`（修复：旧实现丢弃名称）
            await this.feedManager.addFeed(feed.url, feed.category || '未分类', feed.title);
            added++;
          } catch {
            // skip duplicates
          }
        }
        new Notice(`已导入 ${added} 个订阅源（共 ${feeds.length} 个）`);
      } catch (error) {
        new Notice('订阅源文件解析失败');
        console.error('OPML parse error:', error);
      }
      })();
    });
    input.click();
  }
}
