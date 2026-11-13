# Changelog

## 0.2.0 — 2026-11-13

### 变更

- 插件更名为 **Visible Git Graph**，插件 id 改为 `visible-git-graph`；安装目录同步改为 `.obsidian/plugins/visible-git-graph`。
- 视图类型和样式类名改用本项目自己的前缀（`visible-git-graph-*` / `vgg-*`）。
- 设置页移除多余的顶层标题；插件描述改为动作句。

## 0.1.1 — 2026-11-13

维护版本：按 Obsidian 社区扫描器的结果修正实现，不改变功能。

### 修复

- 差异请求中止时始终以 `Error` 拒绝，不再抛出任意 rejection 值。
- 持久化设置按 `unknown` 读取；布局引擎的定长数组改用带类型的 `Array` 构造。
- 仓库 watcher 的去抖定时器改用 `window.*` 以兼容弹出窗口；对应单测切换到 jsdom 环境。

## 0.1.0 — 2026-11-13

首个可用版本。

### 新增

- 右侧 Git Graph 面板：仓库/分支标题、搜索、引用过滤、刷新；四列无表头、左对齐（Graph/Description/Date/Author），refs 胶囊在节点右侧，日期为相对时间。
- 点击提交就地展开详情（再次点击收起）：作者/提交者/日期/父提交/完整 message、文件列表（列表/树、状态色、`+n/-n`）。
- 点击文件在独立编辑器标签页打开 Git diff：hunk、旧/新行号、增删底色、虚拟滚动、二进制提示。
- 设置页：`gitPath`、`pageSize`（10–5000）、`refFilter`（local/all）、`dateFormat`。
- 仓库自动刷新（`fs.watch(.git)` + 300ms 去抖，支持 worktree 的 `.git` 指针与共享元数据）。
- 分页（滚动触底自动加载，无独立按钮）与 >1000 行虚拟化（单个 SVG 保持全高）。
- 非仓库 / git 缺失 / 命令失败三态，展示 git stderr 原文与重试。

### 质量

- 布局引擎从 dsh-vsc-git-graph 逐函数移植，36 项契约/黄金基准全绿。
- git 访问层、详情/diff 解析、分页合并、设置、watcher 均有 vitest 单测。
- `npm run typecheck`、`npm test`、`npm run build` 全绿。

### 已知限制

- 仅桌面端，需要本机 `git`。
- 只读，不做写操作；diff 仅文本预览，二进制显示提示。
- 极端拓扑下布局引擎仍有 O(n²) 风险。
