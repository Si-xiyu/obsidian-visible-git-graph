# 任务：从零实现 Obsidian 插件 Visible Git Graph

> 给 `E:\Code\obsidian-dsh-git-graph`（当前是空目录）里的 agent 使用。
> 分段执行：每个 Phase 结束都要 `typecheck + test + build` 全绿，并提交一次（中文、可读的提交信息）。
> 遇到不确定的设计点，按本文档执行；与本文档冲突时先停下并在回复里指出。

---

## 0. 背景与硬规则

目标：一个 **桌面端** Obsidian 插件，在右侧面板显示当前 vault 的 git 提交图（泳道 + 引用胶囊 + 提交详情 + 文件差异），
交互参照 VS Code Git Graph 的操作习惯。

**硬规则（违反即返工）**

1. **不得复制任何第三方 Git 图实现**（包括 VS Code Git Graph 等）。布局引擎只从
   `E:\Code\dsh-vsc-git-graph\src\graph.js` 移植（我们自己的 MIT 代码，署名 `Si-xiyu`）。
2. 不新增运行时依赖：只用 `vue`；不要引入图表库/日期库。
3. 不联网、不执行远端代码、不做遥测（Obsidian 审核要求）。
4. 每个 git 操作都是一次进程 spawn（本机约 60ms），凡是「一次点击触发几次 spawn」都要按这个成本设计。
5. `manifest.json` 的 `isDesktopOnly` 必须为 `true`（要用 `child_process`）。

## 0.5 工作流（必须遵守）

这份任务按「你统筹、子代理干活、review 把关」的方式推进，不要一个人闷头写完：

1. **每轮最多 2 个开发子代理并行**。你只负责：拆分任务、给每个子代理划清文件边界、验收、提交。
   同一轮里两个子代理**不得修改同一个文件**（例如一个做 `src/git/*`，一个做 `src/graph/*`）。
2. 每个子代理的任务书必须自包含：要读哪些文件、改哪些文件、验收命令、禁止事项。
3. **每个 Phase 完成后，单独起一个只读 review 子代理**：对照 `AGENT-TASK.md` 与实际代码，
   跑 `npm run typecheck && npm test && npm run build`，输出「严重/中等/轻微」问题清单（带 `文件:行号` 与一句话修法）。
   review 子代理**不得修改代码**。
4. 你根据 review 结果修正（或再派开发子代理修正），**修完重跑一遍全量验收**，全绿才进入提交。
5. **每次提交都要写人类可读的总结报告**（维护 git log 可读性），固定三段：
   - 为什么改（问题/背景，一到三句）
   - 做了什么（按文件或按行为列，不要贴代码）
   - 验证（测试通过数、手动检查结论；如有跳过项写明原因）
6. 然后进入下一个 Phase，重复 1–5。
7. **停下来问人的三种情况**：需要产品/许可决策；同一问题连续 3 次修不好；发现任务书本身与验收冲突。
8. 子代理后端说明：优先用本会话可用的子代理工具；如果后端报错（历史上出现过 `0xC000013A` / product-error），
   退回用 codex CLI 跑后台作业：`codex exec -C . -s danger-full-access -o <最后消息文件> -`（stdin 传任务书），
   并从 log 文件里取结论；**不要因为子代理不可用就自己跳过 review 环节**。

## 1. 参考资产（只读）

| 用途 | 路径 |
|---|---|
| 布局引擎（移植源） | `E:\Code\dsh-vsc-git-graph\src\graph.js` |
| 行为规格 | `E:\Code\dsh-vsc-git-graph\docs\GRAPH-SPEC.md` |
| 验收测试（14 项契约） | `E:\Code\dsh-vsc-git-graph\test\graph.contract.test.js` |
| 验收测试（20 项黄金基准） | `E:\Code\dsh-vsc-git-graph\test\graph.golden.test.js` + `test\fixtures\graph-golden.json` |
| 视觉参数（网格/色板/尺寸） | 同上规格 §11 与 `src/graph.js` 的常量 |

引擎对外 API（移植时保持）：

```ts
buildLayout(commits, options) => {
  paths:  { d: string; colour: string; committed: boolean; dashed: boolean }[]
  points: { row: number; x: number; y: number; colour: string; current: boolean;
            stash: boolean; stashInternal: boolean; committed: boolean }[]
  rowWidths: number[]   // 每行图宽（描述列据此右移）
  rowSlots:  number[]   // 每行颜色槽；-1 = 内部灰
  muted:     boolean[]
  contentWidth: number; width: number; height: number
  nav: { firstParent(r), otherParent(r), firstChild(r), otherChild(r), canDrop(r) }
}
```

`options`：`{ head, expandedRow, firstParentOnly, muteMerges, muteNonAncestors, style, palette?, grid?,
uncommittedMark, maxWidth }`。

---

## Phase 0 — 脚手架（目标：`npm run build` 产出可加载的三件套）

1. `manifest.json`：

```json
{ "id": "visible-git-graph", "name": "Visible Git Graph", "version": "0.2.1",
  "minAppVersion": "1.5.0", "description": "Show the vault repository's Git history as a commit graph.",
  "author": "Si-xiyu", "isDesktopOnly": true }
```

2. `package.json`：`type: module`；脚本 `dev`（`vite build --watch`）、`build`（`tsc --noEmit && vite build`）、
   `test`（`vitest run`）、`typecheck`。依赖：`vue`；devDeps：`obsidian`、`vite`、`@vitejs/plugin-vue`、
   `typescript`、`@types/node`、`vitest`、`jsdom`、`vue-tsc`。
3. `tsconfig.json`：`target ES2020`、`module ESNext`、`moduleResolution bundler`、`strict`、`types: ["node"]`。
4. `vite.config.ts`：`build.lib`（entry `src/main.ts`，`formats: ['cjs']`，`fileName: () => 'main.js'`，
   `outDir: 'dist'`）；`rollupOptions.external` 至少包含 `obsidian`、`electron`、`node:*` 与所有 node 内置模块；
   `define: { 'process.env.NODE_ENV': ... }`；自定义插件把 `styles/*.css` 拼成 `styles.css` 并用
   `this.emitFile({ type:'asset', fileName:'styles.css', source })` 产出。
5. `src/main.ts`：`export default class extends Plugin`，`onload()` 里 `registerView`、`addRibbonIcon`、
   `addCommand({id:'open'})`；`src/view.ts` 继承 `ItemView`，`onOpen` 往 `contentEl` 挂 Vue 应用，
   `onClose` 卸载；先渲染一行 `loading…` 即可。
6. 验收：`npm run build` 后 `dist/` 里有 `main.js`、`styles.css`；把 `manifest.json`+`main.js`+`styles.css`
   放进测试 vault 的 `.obsidian/plugins/visible-git-graph/` 能在面板区打开空白视图。

## Phase 1 — git 访问层（目标：能拿到提交与 refs，且全部有单测）

`src/git/run.ts`：

```ts
execFile(gitPath, args, { cwd, timeout: 15_000, maxBuffer: 64 << 20, windowsHide: true,
  encoding: 'utf8', env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0' } })
```

- 错误归一为 `{ code: 'ENOENT' | 'TIMEOUT' | 'EXIT', stderr }`，**必须把 git 的 stderr 原样带给 UI**。
- `src/git/repo.ts`：
  - `resolveRepoRoot(vaultBase)` → `rev-parse --show-toplevel`（失败 = 非仓库）；
  - `log({ count, skip })` → `git log --all --date-order -z --format=%H%x1f%P%x1f%an%x1f%ae%x1f%at%x1f%cn%x1f%ce%x1f%ct%x1f%B`
    **多取一条**判断 `moreAvailable`；
  - `refs()` → `for-each-ref --format='%(refname)%09%(objecttype)%09%(objectname)%09%(*objectname)' refs/heads refs/remotes refs/tags`，
    annotated tag 用 peeled 字段；
  - `status()` → `status --porcelain=v1 -z --untracked-files=all`（脏文件计数用）。
- 单测（vitest + `mkdtemp` 造真仓库）：线性/分叉/合并/tag/stash、非仓库、`gitPath` 不存在、超出窗口的父提交。

## Phase 2 — 布局引擎移植（目标：34 项验收全绿）

1. `src/graph/engine.ts`：把 `src/graph.js` 逐函数移植为 TS（补类型、不改逻辑），
   文件头写 `Ported from dsh-vsc-git-graph (MIT, © 2026 Si-xiyu)`。
2. `src/graph/types.ts`：`Commit { hash; parents; message?; author?; email?; date?; stash?; stashInternal? }`。
3. 把 14 项契约 + 20 项黄金基准改写成 `tests/graph/engine.test.ts`（fixture 原样搬），**断言不得放宽**。
4. 验收：`npm test` 34 项全绿。

## Phase 3 — 表格 + 图谱渲染（目标：结构与 DSH 版一致）

- 一个表格组件 `src/ui/GraphTable.vue`：
  - 列：`Graph | Description | Author | Date | Commit`；行高 24、字号 13；
  - Graph 列宽 = `max(rowWidths)`；描述单元格 `margin-left: prefs.align ? rowWidths[i] - 32 : 0`（默认 `align=false`）；
  - 右侧三列右对齐；表头 `padding:6px 12px`，底部 1px 分隔线；
  - 行状态：`muted` → 文字 `opacity:.5`；当前提交描述加粗；hover `rgba(128,128,128,.15)`；选中行 `commitDetailsOpen`。
- 图谱 `src/ui/GraphCanvas.vue`：**单个绝对定位 `<svg>`**（覆盖列表，`pointer-events:none`，只有圆圈 `pointer-events:all`）；
  每条 path 先画 shadow（背景色、宽 4、opacity .75）再画 line（宽 2）；圆点 r=4，当前提交空心（stroke 2），
  `stash` 双层圆（外 4.5、内 2），`stashInternal` 灰、`dashed`；宽度限制时右侧 `mask-image` 渐隐。
- refs 胶囊：18px 高、圆角 5、1px `rgba(128,128,128,.75)` 边框；左侧 14×14 图标块用该行颜色填充。
- 日期格式 `DD Mon YYYY HH:mm`（英文月份缩写）。
- 验收：用测试 vault 打开，五列对齐、图在 Graph 列内、无断线；与 `docs/GRAPH-SPEC.md` 的尺寸逐项一致。

## Phase 4 — 详情与差异（目标：点击不卡）

- 点击行：**立刻**用列表数据渲染摘要（作者/邮箱/提交者/日期/父提交/完整 message），文件列表显示
  `正在读取变更文件…`；数据回来后替换；
- 详情数据：`show -s --format=...` 一条 + `--name-status -z` 与 `--numstat -z` **并行**两条；
- `Map<hash, details>` 缓存，刷新/换仓清空；
- 文件列表支持树/列表切换、状态字母上色、`+n/-n`；
- 点击文件：底部 diff 抽屉（可拖拽 200px–70vh），复用「按文件分组 + 行号 + 增删底色 + 虚拟滚动」的解析器；
- 验收：点击到出现内容 < 50ms（本地仓库实测），同一条再次点击瞬开；点击瞬间不超过 2 个 git 进程。

## Phase 5 — 设置、刷新、边界状态

- 设置页：`gitPath`（默认 `git`，允许绝对路径）、`pageSize`（默认 200，10–5000）、`refFilter`（auto/all）、`dateFormat`。
- 刷新：`fs.watch(gitDir)` + 300ms 去抖；面板关闭时暂停监听，打开时补一次刷新。
- 三态 UI：`ready` / `none`（vault 不是仓库）/ `error`（git 缺失或命令失败，显示 stderr 原文 + 重试按钮）。
- 分页：滚到底部 25px 内自动加载下一页；「加载更多」按钮兜底。
- 大仓库（>1000 提交）行虚拟化：只渲染可视区 ± 若干行（图谱仍为单个 SVG，可用 `viewBox` 平移）。
- 验收：非仓库 vault 有清晰提示；关面板后无轮询；2000 提交的仓库滚动流畅。

## Phase 6 — 打包与发布材料

- `dist/` 不进 git；README 写清安装方式（release 三件套）、截图、限制（桌面端、需本机 git）。
- `LICENSE`（MIT，`Si-xiyu`）+ `THIRD_PARTY_NOTICES.md`：写明布局引擎移植自 `dsh-vsc-git-graph`（MIT）；
  行为与视觉规范参考 VS Code Git Graph，**不含其代码**。
- 版本号、CHANGELOG 起步。

---

## 每阶段的提交要求

提交信息用中文，包含「为什么改 / 做了什么 / 验证」三段（与本项目既有风格一致），例如：

```
feat(graph): 移植布局引擎并通过 34 项验收

为什么：需要与 DSH 版一致的走线，且不能包含第三方实现。
做了什么：src/graph/engine.ts（移植自 dsh-vsc-git-graph，MIT）；tests/graph/engine.test.ts（14+20 项）。
验证：npm test 34/34；npm run build 通过。
```

## 最终交付

1. 目录树与各文件行数；
2. `typecheck` / `test` / `build` 的真实输出摘要（通过/失败数）；
3. 手动验收结果（五列对齐、合并回折、点击延迟、非仓库提示）；
4. 未完成项与原因（例如尚未行虚拟化、diff 抽屉只支持文本）。
