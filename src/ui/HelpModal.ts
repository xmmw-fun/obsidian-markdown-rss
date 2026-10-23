import { App, Component, MarkdownRenderer, Modal } from 'obsidian';
import helpMarkdown from '../help.md';

/** 用户使用手册 Modal：渲染内嵌的 help.md（2026-10-22 上架整改 2a 项：
 *  使用手册随插件分发，设置面板一键打开，不走仓库外链）。 */
export class HelpModal extends Modal {
  private component?: Component;

  constructor(app: App) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.addClass('rss-help-modal');
    contentEl.createEl('h2', { text: 'Markdown RSS 使用说明' });

    const body = contentEl.createDiv({ cls: 'rss-help-body' });
    // MarkdownRenderer 的 component 参数用于管理渲染产物的生命周期；
    // Modal 本身不是 Component，需自建一个并在关闭时卸载
    this.component = new Component();
    this.component.load();
    void MarkdownRenderer.render(this.app, helpMarkdown, body, '', this.component);
  }

  onClose(): void {
    this.component?.unload();
    this.component = undefined;
    this.contentEl.empty();
  }
}
