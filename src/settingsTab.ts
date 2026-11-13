import { PluginSettingTab, Setting, type App } from 'obsidian';
import type DshGitGraphPlugin from './main';
import { DEFAULT_SETTINGS, type GraphSettings } from './settings';

/**
 * Settings tab for the graph pane.
 *
 * Text fields commit on blur or Enter (not on every keystroke): every save
 * re-renders open graph views, so saving per character would detach and reopen
 * the pane constantly.
 */
export class GitGraphSettingTab extends PluginSettingTab {
  private readonly plugin: DshGitGraphPlugin;

  constructor(app: App, plugin: DshGitGraphPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  private persist(patch: Partial<GraphSettings>, after?: () => void): void {
    void this.plugin
      .saveSettings(patch)
      .then(() => after?.())
      .catch((error: unknown) => {
        console.error('Git Graph: 保存设置失败', error);
      });
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl).setName('Git Graph').setHeading();

    new Setting(containerEl)
      .setName('Git 可执行文件')
      .setDesc(
        '默认使用 PATH 中的 git。也可以填写绝对路径，例如 C:\\Program Files\\Git\\cmd\\git.exe。修改后按回车或点击输入框外保存。',
      )
      .addText((text) => {
        text.setPlaceholder('git').setValue(this.plugin.settings.gitPath);

        const commit = (): void => {
          const value = text.getValue().trim();
          const next = value === '' ? DEFAULT_SETTINGS.gitPath : value;
          if (next === this.plugin.settings.gitPath) {
            text.setValue(next);
            return;
          }
          this.persist({ gitPath: next }, () =>
            text.setValue(this.plugin.settings.gitPath),
          );
        };

        text.inputEl.addEventListener('blur', commit);
        text.inputEl.addEventListener('keydown', (event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            commit();
          }
        });
      });

    new Setting(containerEl)
      .setName('每页提交数')
      .setDesc('每次加载的提交数量，范围 10–5000，默认 200。失焦或按回车保存。')
      .addText((text) => {
        const input = text.inputEl;
        input.type = 'number';
        input.min = '10';
        input.max = '5000';
        input.step = '1';
        text.setValue(String(this.plugin.settings.pageSize));

        const commit = (): void => {
          const parsed = Number.parseInt(text.getValue(), 10);
          if (!Number.isFinite(parsed) || parsed === this.plugin.settings.pageSize) {
            text.setValue(String(this.plugin.settings.pageSize));
            return;
          }
          this.persist({ pageSize: parsed }, () =>
            text.setValue(String(this.plugin.settings.pageSize)),
          );
        };

        input.addEventListener('blur', commit);
        input.addEventListener('keydown', (event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            commit();
          }
        });
      });

    new Setting(containerEl)
      .setName('引用过滤')
      .setDesc('Local 只显示本地分支与标签；All 还会显示远端跟踪引用。')
      .addDropdown((dropdown) => {
        dropdown
          .addOption('local', 'Local（本地分支与标签）')
          .addOption('all', 'All（含远端跟踪引用）')
          .setValue(this.plugin.settings.refFilter)
          .onChange((value) => {
            const next = value === 'all' ? 'all' : 'local';
            if (next === this.plugin.settings.refFilter) {
              return;
            }
            this.persist({ refFilter: next });
          });
      });

    new Setting(containerEl)
      .setName('日期格式')
      .setDesc('默认 DD Mon YYYY HH:mm（英文月份缩写）。修改后点击输入框外或按回车保存。')
      .addText((text) => {
        text
          .setPlaceholder(DEFAULT_SETTINGS.dateFormat)
          .setValue(this.plugin.settings.dateFormat);

        const commit = (): void => {
          const value = text.getValue().trim();
          const next = value === '' ? DEFAULT_SETTINGS.dateFormat : value;
          if (next === this.plugin.settings.dateFormat) {
            text.setValue(next);
            return;
          }
          this.persist({ dateFormat: next }, () =>
            text.setValue(this.plugin.settings.dateFormat),
          );
        };

        text.inputEl.addEventListener('blur', commit);
        text.inputEl.addEventListener('keydown', (event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            commit();
          }
        });
      });

    containerEl.createEl('p', {
      cls: 'setting-item-description',
      text: '设置保存在插件数据文件中，不会修改仓库内容。',
    });
  }
}
