import { App, PluginSettingTab, Setting, Notice, Plugin, type SettingDefinitionItem } from 'obsidian';
import type { FilterRule } from '../types';
import { FeedManager } from '../managers/FeedManager';
import { StorageManager } from '../managers/StorageManager';
import { parseOPML } from '../utils/opmlParser';
import { HelpModal } from './HelpModal';

export class SettingsTab extends PluginSettingTab {
  private feedManager: FeedManager;
  private storageManager: StorageManager;

  constructor(app: App, plugin: Plugin, feedManager: FeedManager, storageManager: StorageManager) {
    super(app, plugin);
    this.feedManager = feedManager;
    this.storageManager = storageManager;
  }

  /** 声明式设置 API（1.13+）。
   *  返回空数组 = 本面板的设置项全部由 display() 动态生成（规则列表等内容
   *  依赖运行时数据，无法静态声明）。注意：只有返回**非空**数组时 Obsidian
   *  才跳过 display()（019 实战教训），空数组时 display() 照常被调用。 */
  getSettingDefinitions(): SettingDefinitionItem[] {
    return [];
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl).setName('设置').setHeading();

    // 用户使用手册入口（2026-10-22 上架整改 2a：手册随插件分发，设置面板可跳转）
    new Setting(containerEl)
      .setName('使用说明')
      .setDesc('打开完整用户使用手册（添加订阅源、刷新、关键词筛选、收藏等）')
      .addButton(btn => {
        btn.setButtonText('打开使用说明');
        btn.onClick(() => {
          new HelpModal(this.app).open();
        });
      });
    
    this.renderGeneralSettings(containerEl);
    this.renderConfigInfo(containerEl);
    this.renderFilterSettings(containerEl);
  }

  private renderGeneralSettings(containerEl: HTMLElement): void {
    new Setting(containerEl).setName('通用').setHeading();
    
    new Setting(containerEl)
      .setName('刷新间隔（分钟）')
      .setDesc('自动刷新订阅源的时间间隔')
      .addText(text => {
        text.inputEl.type = 'number';
        text.setValue(String(this.storageManager.getSettings().refreshInterval));
        text.onChange(async (value) => {
          const interval = parseInt(value) || 60;
          await this.storageManager.updateSettings({ refreshInterval: interval });
          this.feedManager.stopAutoRefresh();
          this.feedManager.startAutoRefresh();
        });
      });

    new Setting(containerEl)
      .setName('每个订阅源最多文章数')
      .setDesc('超过此数量时，自动删除最旧的文章')
      .addText(text => {
        text.inputEl.type = 'number';
        text.setValue(String(this.storageManager.getSettings().maxArticlesPerFeed));
        text.onChange(async (value) => {
          const max = parseInt(value) || 50;
          await this.storageManager.updateSettings({ maxArticlesPerFeed: max });
        });
      });
    
    new Setting(containerEl)
      .setName('保存文件夹')
      .setDesc('收藏文章保存到的文件夹名称')
      .addText(text => {
        text.setValue(this.storageManager.getSettings().saveFolder);
        text.onChange(async (value) => {
          await this.storageManager.updateSettings({ saveFolder: value });
        });
      });
    
    new Setting(containerEl)
      .setName('文章命名模板')
      .setDesc('支持变量: {date}, {title}, {author}, {source}')
      .addText(text => {
        text.setValue(this.storageManager.getSettings().articleNamingTemplate);
        text.onChange(async (value) => {
          await this.storageManager.updateSettings({ articleNamingTemplate: value });
        });
      });
    
    new Setting(containerEl)
      .setName('配置文件路径')
      .setDesc('订阅源配置文件的路径（相对于 vault 根目录）。修改后立即生效并重新加载')
      .addText(text => {
        text.setValue(this.storageManager.getSettings().configFilePath);
        text.onChange(async (value) => {
          const trimmed = value.trim();
          if (!trimmed) return;
          await this.storageManager.updateSettings({ configFilePath: trimmed });
          // 修复：旧实现只改 settings，FeedConfigManager 仍指向旧路径、改完不生效
          await this.feedManager.setConfigFilePath(trimmed);
          this.display();
          new Notice(`配置文件路径已切换为 ${trimmed}`);
        });
      });
  }

  private renderConfigInfo(containerEl: HTMLElement): void {
    new Setting(containerEl).setName('订阅源').setHeading();
    
    const configPath = this.storageManager.getSettings().configFilePath;
    const feeds = this.feedManager.getFeeds();
    
    new Setting(containerEl)
      .setName('配置文件')
      .setDesc(`订阅源由配置文件 ${configPath} 管理，可直接编辑该文件添加/删除订阅源`)
      .addButton(btn => {
        btn.setButtonText('打开配置文件');
        btn.onClick(() => {
          void this.app.workspace.openLinkText(configPath, '');
        });
      });
    
    new Setting(containerEl)
      .setName('当前订阅源数量')
      .setDesc(`共 ${feeds.length} 个订阅源（${feeds.filter(f => f.enabled).length} 个启用）`)
      .addButton(btn => {
        btn.setButtonText('重新加载配置');
        btn.onClick(async () => {
          await this.feedManager.reloadConfig();
          this.display();
          new Notice('配置已重新加载');
        });
      });

    new Setting(containerEl)
      .setName('导入订阅源清单')
      .setDesc('从其他阅读器导出的订阅源清单中批量导入')
      .addButton(btn => {
        btn.setButtonText('选择文件');
        btn.onClick(() => {
          const input = createEl('input');
          input.type = 'file';
          input.accept = '.opml,.xml';
          input.addEventListener('change', () => {
            void (async () => {
            const file = input.files?.[0];
            if (!file) return;

            try {
              const content = await file.text();
              const opmlFeeds = parseOPML(content);

              if (opmlFeeds.length === 0) {
                new Notice('未找到有效的订阅源');
                return;
              }

              let added = 0;
              for (const feed of opmlFeeds) {
                try {
                  await this.feedManager.addFeed(feed.url, feed.category || '未分类');
                  added++;
                } catch {
                  // skip duplicates
                }
              }
              new Notice(`已导入 ${added} 个订阅源（共 ${opmlFeeds.length} 个）`);
              this.display();
            } catch {
              new Notice('订阅源文件解析失败');
            }
            })();
          });
          input.click();
        });
      });
  }

  private renderFilterSettings(containerEl: HTMLElement): void {
    new Setting(containerEl).setName('关键词筛选').setHeading();

    // 规则说明（2026-10-21 阿麦要求「把规则说明白」）：
    // 匹配范围、白/黑名单定义、组合方式的效果，全部写在界面上，不让用户猜。
    const desc = containerEl.createEl('p', { cls: 'rss-setting-desc' });
    desc.setText(
      '匹配范围：只匹配文章的标题与摘要（不匹配正文、作者）。' +
      '白名单＝只显示含该词的文章；黑名单＝不显示含该词的文章。' +
      '两种名单同时开启时，按下方「组合方式」决定显示逻辑。'
    );

    new Setting(containerEl)
      .setName('名单组合方式')
      .setDesc('白名单与黑名单同时开启时如何组合；只开一种名单时此设置无影响')
      .addDropdown(dropdown => {
        dropdown
          .addOption('and', '同时满足：含白名单的词，且不含黑名单的词')
          .addOption('or', '任一满足：含白名单的词，或不含黑名单的词')
          .setValue(this.storageManager.getSettings().filterCombineMode || 'and')
          .onChange(async (value) => {
            await this.storageManager.updateSettings({ filterCombineMode: value as 'and' | 'or' });
            // 即时通知已打开的 RSS 面板重新过滤渲染
            this.feedManager.onFilterRulesChanged?.();
          });
      });

    // 添加规则用的元素引用（addDropdown/addText 的回调里赋值）
    let typeSelectEl: HTMLSelectElement | undefined;
    let keywordInputEl: HTMLInputElement | undefined;

    const rules = this.storageManager.getFilterRules();
    
    rules.forEach((rule: FilterRule) => {
      const ruleSetting = new Setting(containerEl)
        .setName(`${rule.type === 'include' ? '包含' : '排除'}: ${rule.keyword}`);
      
      ruleSetting.addToggle(toggle => {
        toggle.setValue(rule.enabled);
        toggle.onChange(async (value) => {
          await this.storageManager.updateFilterRule(rule.id, { enabled: value });
          // 即时通知已打开的 RSS 面板重新过滤渲染
          this.feedManager.onFilterRulesChanged?.();
        });
      });
      
      ruleSetting.addButton(btn => {
        btn.setIcon('trash');
        btn.onClick(async () => {
          await this.storageManager.deleteFilterRule(rule.id);
          this.feedManager.onFilterRulesChanged?.();
          this.display();
        });
      });
    });
    
    new Setting(containerEl)
      .setName('添加筛选规则')
      .setDesc('白名单（包含）或黑名单（排除）关键词')
      // 修复：旧实现靠 btn.buttonEl.previousElementSibling 数 DOM 兄弟节点取值，
      // 结构一变就取错；现直接保存下拉框与输入框的元素引用
      .addDropdown(dropdown => {
        dropdown
          .addOption('include', '包含（白名单）')
          .addOption('exclude', '排除（黑名单）')
          .setValue('include');
        typeSelectEl = dropdown.selectEl;
      })
      .addText(text => {
        text.setPlaceholder('关键词');
        keywordInputEl = text.inputEl;
      })
      .addButton(btn => {
        btn.setButtonText('添加');
        btn.onClick(async () => {
          const type = ((typeSelectEl?.value as 'include' | 'exclude') || 'include');
          const keyword = keywordInputEl?.value.trim() || '';

          if (!keyword) {
            new Notice('请输入关键词');
            return;
          }

          await this.storageManager.addFilterRule(type, keyword);
          if (keywordInputEl) keywordInputEl.value = '';
          new Notice('添加成功');
          this.display();
        });
      });
  }
}
