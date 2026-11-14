# Changelog

## 0.2.4 — 2026-11-14

### 修复

- 面板不再递归监听整个 `.git`：只监听 `HEAD`、`packed-refs`、`index`、`logs/HEAD` 和 `refs/`。此前读取 `.git/objects` 里的对象会更新 atime（Windows），`fs.watch` 把它当成变化并触发整页重新加载，表现为连续点击提交/文件后面板闪回 Loading。

### 测试

- 新增 watcher 回归测试：`.git/objects` 写入不触发，ref 与 index 写入仍触发。

## 0.2.3 — 2026-11-14

### 变更

- 提交列表的日期与作者列改为右对齐并适当收窄，把横向空间让给提交描述。

## 0.2.2 — 2026-11-14

### 修复

- `minAppVersion` 抬到 1.7.2：`Workspace.revealLeaf` 的 Promise 形态从 1.7.2 开始，修掉社区扫描器的 `no-unsupported-api` error。
- 设置页的异步保存回调不再把组件的链式返回值当作 Promise 返回。
- Release 只上传 `manifest.json` / `main.js` / `styles.css` 三件套，并为它们生成 artifact attestation；不再上传 `versions.json` 和 zip。

### 文档

- README 改为英文为主、中文附后，并补充插件访问范围（只运行 `git` 读命令、只读 `.git`、不联网、无遥测）。

## 0.2.1 — 2026-11-13

### 修复

- Release 标题和 zip 包名仍使用旧项目名，现改为 **Visible Git Graph** / `visible-git-graph-<version>.zip`。

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
