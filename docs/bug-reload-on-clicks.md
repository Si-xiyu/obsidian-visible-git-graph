# Bug 诊断：连续点击提交/文件后面板重置为 Loading

- 报告时间：2026-11-14
- 插件版本：Visible Git Graph `0.2.2`
- 环境：Windows + Obsidian（桌面端）
- 参考实现：`E:\Code\obsidian-git-graph`（Luis85 obsidian-git-graph 0.4.0，无此问题）
- 状态：已在 `0.2.4` 修复——`src/graph/watch.ts` 改为只监听 `HEAD`/`packed-refs`/`index`/`logs/HEAD`/`refs/`，不再监听 `.git/objects`，并补充回归测试。

## 结论（根因）

**仓库 watcher 递归监听了整个 `.git` 目录（包括 `.git/objects/**`）；点击提交/文件会运行 `git show` 读取对象文件，Windows 上读取会更新文件的 last-access time，`fs.watch` 把这次 atime 更新当作 `change` 事件上报，300ms 去抖后触发 `reload()`，面板因此回到 `loading…`。**

这不是随机 bug，而是「读到的旧对象数量 + NTFS atime 延迟落盘」共同决定的：前几次点击读到的对象 atime 还新鲜（初始 `git log` 刚读过），后面点击读到 tree/blob 对象时 atime 过期；读了几次之后 Windows 批量把 atime 写回，事件集中到达，去抖后正好触发一次整页刷新。

## 代码路径

1. 面板的 Loading 只由 `reload()` 设置：
   - [`src/ui/Root.vue:149`](../src/ui/Root.vue#L149) `reload()`
   - [`src/ui/Root.vue:170-171`](../src/ui/Root.vue#L170-L171) `state = 'loading'`、`model = null`
2. `reload()` 由仓库 watcher 调用：
   - [`src/ui/Root.vue:134-136`](../src/ui/Root.vue#L134-L136)
3. watcher 递归监听整个 `.git`：
   - [`src/graph/watch.ts:41-72`](../src/graph/watch.ts#L41-L72) `watchTargets()` 直接返回 `.git`（或 worktree 的 gitDir/commonDir）
   - [`src/graph/watch.ts:130-132`](../src/graph/watch.ts#L130-L132) `attach(target, true)` 递归监听
   - [`src/graph/watch.ts:100-107`](../src/graph/watch.ts#L100-L107) 300ms 去抖后调用 `onChange`
4. 点击提交 / 文件会读取对象：
   - [`src/git/detail.ts:234-240`](../src/git/detail.ts#L234-L240)：`git show -m --first-parent --name-status/--numstat`
   - [`src/git/diff.ts:385-402`](../src/git/diff.ts#L385-L402)：`git show <hash> -- <path>`

`runGit` 设置了 `GIT_OPTIONAL_LOCKS=0`（[`src/git/run.ts:93`](../src/git/run.ts#L93)），所以**写** index 不是原因；问题出在**读**对象文件导致的 atime 更新。

## 实验证据

### 1. 读取过期 atime 的文件会产生 `fs.watch` change

```text
watch(dir) + 把文件 atime 设为 1 小时前 + readFileSync
→ events: 1 [{ type: 'change', file: 'a.txt' }]
```

Windows 的 `ReadDirectoryChangesW`/libuv 会监听 last-access 变化，Node 的 `fs.watch` 把它报告为 `change`。

### 2. 递归监听 `.git` 时，`git show` 产生大量 objects 事件

在 `.test-vault`（worktree，gitDir 指向主仓库 `.git/worktrees/-test-vault`，commondir 是主仓库 `.git`）上递归监听 `.git`，执行插件实际使用的命令：

| 命令 | 事件数 | 事件位置 |
|---|---|---|
| `git show -s --format=...` | 13 | `.git/objects/**`，全部 `change` |
| `git show -m --first-parent --name-status` | 0 | — |
| `git show -m --first-parent --numstat` | 22 | `.git/objects/**`，全部 `change` |
| `git show <hash>:<path>` | 0 | — |
| `git log --all` | 0 | — |

对象文件 atime 的新鲜程度不同，所以每次命令的事件数会变化；这正是「点 4-5 次才触发、不是每次触发」的原因。

### 3. 定向监听同样的命令不产生事件

把监听改成只监听 `HEAD`、`packed-refs`、`index`、`logs/HEAD` 和 `refs/**`（不监听 `objects/`），在同一个 `.test-vault` 上重复上面的命令：

| 命令 | 事件数 |
|---|---|
| `git show -s` | 0 |
| `git show --name-status` | 0 |
| `git show --numstat` | 0 |
| `git show <hash>:<path>` | 0 |
| `git status` | 0 |
| `git log` | 0 |

## 为什么参考实现没有这个 bug

参考仓库的 watcher（`E:\Code\obsidian-git-graph\src\watch\gitWatcher.ts`）是**定向监听**：

- `E:\Code\obsidian-git-graph\src\watch\gitWatcher.ts:27-33`：`FILES = ['HEAD', 'packed-refs', 'index', 'logs/HEAD']`，`REF_DIRS = ['refs/heads', 'refs/remotes', 'refs/tags']`。
- `E:\Code\obsidian-git-graph\src\watch\gitWatcher.ts:45-53`：只对 gitDir 挂这些文件/refs 的监听。
- `E:\Code\obsidian-git-graph\src\watch\gitWatcher.ts:110-119`：gitDir 级事件只放行 `HEAD` / `packed-refs` / `index`，其余忽略。
- **它从不监听 `.git/objects/`**，所以 `git show` 读对象不会触发 watcher。

另外它把「git 状态变化」和「工作区 status」拆成两个 emitter（`main.ts:191-198` 的 `statusChanges` 由 vault 编辑去抖触发），不会在每次 graph 加载时用 `git status` 反向触发自己。

## 建议修复

把 [`src/graph/watch.ts`](../src/graph/watch.ts) 从「递归监听整个 `.git`」改成「定向监听元数据」：

1. gitDir：监听 `HEAD`、`packed-refs`、`index`、`logs/HEAD` 这几个文件；监听 gitDir 目录自身，只放行 `HEAD`/`packed-refs`/`index` 的文件名；递归监听 `refs/`（失败时分别监听 `refs/heads`、`refs/remotes`、`refs/tags`）。
2. worktree：gitDir 同上；commonDir 只监听 `packed-refs`、目录事件和 `refs/`。
3. 不监听 `objects/`、`hooks/`、`modules/`、`logs/` 下除 `HEAD` 外的内容。
4. 保留 300ms 去抖、`close()` 幂等、缺失 `.git` 的 fallback。

回归测试（旧实现会失败）：

```ts
it('does not watch .git/objects', async () => {
  root = await mkdtemp(join(tmpdir(), 'visible-git-watch-'));
  await mkdir(join(root, '.git', 'objects', 'aa'), { recursive: true });
  let calls = 0;
  watcher = watchRepo(root, () => { calls += 1; });
  await writeFile(join(root, '.git', 'objects', 'aa', 'bb'), 'x');
  await sleep(450);
  expect(calls).toBe(0);
});
```

同时保留/补充：

- `HEAD`、`index`、`refs/heads/*` 写入 → 必须回调；
- worktree `commondir/packed-refs` 写入 → 必须回调；
- 连续写入仍只回调一次（现有测试）。

可选增强：`reload()` 期间 `pause()` watcher、结束后 `resume()`，避免 `status` 读取 `index` 造成的 atime 自触发；但定向监听已经消除主要来源，可作为后续优化。

## 影响面

- 普通仓库和 worktree 都受影响；worktree 更严重，因为 commondir 是主仓库的整个 `.git`，主仓库里任何 git 活动（包括构建、其它 worktree）也会触发面板刷新。
- 只影响 Windows（atime 事件）；macOS/Linux 通常不会把读取报告为 change。
- 修复后，点击任意数量的提交/文件都不应再出现整页 Loading；只有真正的 HEAD/refs/index 变化才会刷新。
