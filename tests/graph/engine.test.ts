/**
 * 布局引擎验收测试。
 *
 * 移植自 dsh-vsc-git-graph（MIT, © 2026 Si-xiyu）：
 * - graph.contract.test.js 的 16 项契约（原任务书写 14 项，参考仓库已增至 16 项）；
 * - graph.golden.test.js 的 20 项黄金基准，fixture 原样复制。
 *
 * 断言逐条对应，不得放宽、不得删减。
 */
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import {
  buildLayout,
  UNCOMMITTED,
  PALETTE,
  ROW_STYLE,
  UNCOMMITTED_MARK,
  GREY,
} from '../../src/graph/engine';
import type { Commit } from '../../src/graph/types';

/** 构造提交：`commit('A', ['B'])`。 */
const commit = (hash: string, parents: string[] = []): Commit => ({
  hash,
  parents,
  message: hash,
  author: 'a',
  email: 'a@b',
  date: 0,
});

/** 标准菱形：0 = 合并提交，1/2 两条并行分支，3 为共同父。 */
const diamond = (): Commit[] => [
  commit('C0', ['C1', 'C2']),
  commit('C1', ['C3']),
  commit('C2', ['C3']),
  commit('C3'),
];

describe('布局契约', () => {
  it('线性历史：单列、同一颜色槽、每行图宽一致', () => {
    const commits = [commit('A', ['B']), commit('B', ['C']), commit('C')];
    const model = buildLayout(commits, { head: 'A' });

    expect(model.rowSlots, '整条主链必须同一个颜色槽').toStrictEqual([0, 0, 0]);
    expect(model.rowWidths, '单列行宽 = insetX + 1*grid.x - 2').toStrictEqual([30, 30, 30]);
    expect(model.contentWidth, '单列内容宽 = 2*insetX + 0*grid.x').toBe(32);
    expect(model.points.length).toBe(3);
    expect(model.points[0].current, 'HEAD 指向的提交是当前提交').toBe(true);
    expect(model.points[0].x).toBe(16);
    expect(model.points[0].y).toBe(12);

    const committed = model.paths.filter((p) => p.committed);
    expect(committed.length, '连续竖直段必须合并为一条 path').toBe(1);
    expect(committed[0].d).toBe('M16,12.0L16,60.0');
  });

  it('菱形分叉：第二父走新列，颜色槽按分支分配', () => {
    const model = buildLayout(diamond(), { head: 'C3' });

    expect(model.rowSlots, '合并提交与其第一父同槽；第二父开新槽').toStrictEqual([0, 0, 1, 0]);
    expect(model.rowWidths, '有两条线的行更宽（逐行图宽）').toStrictEqual([30, 46, 46, 30]);
    expect(model.contentWidth).toBe(48);

    const blue = model.paths.filter((p) => p.colour === PALETTE[0]);
    const pink = model.paths.filter((p) => p.colour === PALETTE[1]);
    expect(blue.length).toBe(1);
    expect(blue[0].d).toMatch(/^M16,12\.0L16,84\.0$/);
    expect(pink.length).toBe(1);
    expect(pink[0].d).toBe('M16,12.0C16,31.2 32,16.8 32,36.0L32,60.0C32,79.2 16,64.8 16,84.0');

    expect(model.points[2].x, 'C2 落在第 2 列').toBe(32);
    expect(model.points[2].colour).toBe(PALETTE[1]);
  });

  it('颜色槽只在段结束后复用：长分支颜色不跳变', () => {
    const commits = [
      commit('M', ['A1', 'C1']),
      commit('A1', ['A2']),
      commit('C1', ['A2']),
      commit('A2', ['A3']),
      commit('A3', ['A4']),
      commit('A4'),
    ];
    const model = buildLayout(commits, { head: 'M' });
    const mainRows = [0, 1, 3, 4, 5].map((i) => model.rowSlots[i]);
    expect(
      mainRows.every((slot) => slot === mainRows[0]),
      `第一父链颜色必须恒定，实际 ${JSON.stringify(mainRows)}`,
    ).toBe(true);
    expect(model.rowSlots[2], '岔出的分支必须换槽').not.toBe(model.rowSlots[0]);
  });

  it('只跟随第一父：窗口外的第二父不再占列', () => {
    const commits = [commit('A', ['B', 'OUTSIDE']), commit('B')];
    const all = buildLayout(commits, { head: 'A' });
    const first = buildLayout(commits, { head: 'A', firstParentOnly: true });

    expect(all.contentWidth > first.contentWidth, '悬挂的第二父会多占一列').toBe(true);
    expect(first.contentWidth, '只跟第一父时退化成单列').toBe(32);
    expect(first.rowWidths).toStrictEqual([30, 30]);
  });

  it('灰化：合并提交可配；非 HEAD 祖先可配', () => {
    const byMerge = buildLayout(diamond(), { head: 'C3', muteMerges: true });
    expect(byMerge.muted, '只有合并提交变灰').toStrictEqual([true, false, false, false]);

    const byAncestor = buildLayout([commit('X'), ...diamond()], {
      head: 'C3',
      muteNonAncestors: true,
    });
    expect(byAncestor.muted[0], 'X 不是 C3 的祖先').toBe(true);
    expect(byAncestor.muted[4], 'C3 是 HEAD，不变灰').toBe(false);
  });

  it('展开详情：整体拉伸，跨展开行的线被拆开', () => {
    const flat = buildLayout(diamond(), { head: 'C3' });
    const expanded = buildLayout(diamond(), { head: 'C3', expandedRow: 0 });

    expect(expanded.height, '高度增加一个 expand').toBe(flat.height + 250);
    expect(expanded.points[3].y, '展开行下方圆点整体下移').toBe(flat.points[3].y + 250);
    expect(expanded.points[0].y, '展开行自身不动').toBe(flat.points[0].y);
    expect(
      expanded.paths.some((p) => p.d.includes('32,36.0') && p.d.includes('32,310.0')),
      `跨展开行的线必须延伸过展开区，实际 ${JSON.stringify(expanded.paths.map((p) => p.d))}`,
    ).toBe(true);
  });

  it('直角风格只有直线指令，圆角风格有贝塞尔', () => {
    const angular = buildLayout(diamond(), { head: 'C3', style: ROW_STYLE.Angular });
    const rounded = buildLayout(diamond(), { head: 'C3' });

    for (const p of angular.paths) {
      expect(!p.d.includes('C'), `直角风格不得出现贝塞尔：${p.d}`).toBe(true);
    }
    expect(rounded.paths.some((p) => p.d.includes('C')), '圆角风格必须有曲线').toBe(true);
  });

  it('未提交伪提交：灰色、默认空心圆在改动处', () => {
    const commits = [commit(UNCOMMITTED, ['B']), commit('B')];
    const model = buildLayout(commits, { head: 'B' });

    expect(model.rowSlots[0]).toBe(0);
    expect(model.points[0].current, '默认在未提交改动处画空心圆').toBe(true);
    expect(model.points[0].colour, '未提交段是灰色').toBe(GREY);
    expect(model.points[1].colour, '真实提交仍用色板色').toBe(PALETTE[0]);
    const uncommitted = model.paths.filter((p) => !p.committed);
    expect(uncommitted.length > 0, '未提交段必须单独成 path').toBe(true);
    expect(uncommitted.every((p) => p.colour === GREY && p.dashed === false)).toBe(true);

    const atHead = buildLayout(commits, {
      head: 'B',
      uncommittedMark: UNCOMMITTED_MARK.AtHead,
    });
    expect(atHead.points[0].current, '该风格下空心圆在 HEAD 上').toBe(false);
    expect(atHead.points[1].current).toBe(true);
    expect(
      atHead.paths.filter((p) => !p.committed).every((p) => p.dashed === true),
      '该风格下未提交段为虚线',
    ).toBe(true);
  });

  it('stash 提交：双层圆标记', () => {
    const commits = [
      { ...commit('S', ['B']), stash: { selector: 'stash@{0}', baseHash: 'B' } },
      commit('B'),
    ];
    const model = buildLayout(commits, { head: 'B' });
    expect(model.points[0].stash).toBe(true);
    expect(model.points[1].stash).toBe(false);
  });

  it('stash 内部提交：灰色虚线，且不占用普通颜色槽', () => {
    const commits = [
      { ...commit('S', ['B', 'I', 'U']), stash: { selector: 'stash@{0}', baseHash: 'B' } },
      {
        ...commit('I', ['B']),
        stashInternal: { selector: 'stash@{0}', kind: 'index' as const },
      },
      {
        ...commit('U'),
        stashInternal: { selector: 'stash@{0}', kind: 'untracked' as const },
      },
      commit('T', ['B']),
      commit('B'),
    ];
    const model = buildLayout(commits, { head: 'B' });
    const rowOf = (hash: string) => commits.findIndex((c) => c.hash === hash);

    expect(model.points[rowOf('I')].stashInternal).toBe(true);
    expect(model.points[rowOf('I')].colour, 'index 内部提交用灰色').toBe(GREY);
    expect(model.points[rowOf('U')].colour, 'untracked 内部提交用灰色').toBe(GREY);
    expect(model.rowSlots[rowOf('I')], '内部提交不占色板槽').toBe(-1);
    expect(model.points[rowOf('S')].colour, 'stash 本体仍是普通分支色').not.toBe(GREY);

    const internal = model.paths.filter((p) => p.colour === GREY);
    expect(internal.length >= 2, '通向 index / untracked 的线各自成灰色 path').toBe(true);
    expect(internal.every((p) => p.dashed === true), '内部提交的线是虚线').toBe(true);

    expect(model.points[rowOf('T')].colour, '后续真实分支拿到下一个色板色').toBe(PALETTE[1]);
  });

  it('父提交不在窗口内时画到底且不抛错', () => {
    const model = buildLayout([commit('A', ['OUTSIDE']), commit('B', ['OUTSIDE2'])], { head: 'A' });
    expect(model.rowSlots.length).toBe(2);
    expect(model.points.length).toBe(2);
    expect(model.paths.length > 0, '窗口外父提交也必须画出线段').toBe(true);
  });

  it('导航索引：父 / 子 / 备选（含多子规则）', () => {
    const model = buildLayout(diamond(), { head: 'C3' });
    expect(model.nav.firstParent(0), '第一父在主链').toBe(1);
    expect(model.nav.otherParent(0), '第二父在另一分支').toBe(2);
    expect(model.nav.firstParent(3), '根提交没有父').toBe(-1);
    expect(model.nav.otherParent(3), '根提交没有备选父').toBe(-1);

    expect(model.nav.firstChild(3), 'C3 的首选子在主线').toBe(1);
    expect(model.nav.otherChild(3), 'C3 的备选子').toBe(2);
    expect(model.nav.firstChild(0), '最新提交没有子').toBe(-1);

    // 越界不得抛错
    expect(model.nav.firstParent(99)).toBe(-1);
    expect(model.nav.canDrop(99)).toBe(false);
  });

  it('canDrop：合并提交与根提交不可摘，线性中间提交可以', () => {
    const model = buildLayout(diamond(), { head: 'C3' });
    expect(model.nav.canDrop(0), '合并提交本身不可摘').toBe(false);
    expect(model.nav.canDrop(3), '根提交不可摘').toBe(false);

    const linear = buildLayout([commit('A', ['B']), commit('B', ['C']), commit('C')], {
      head: 'A',
    });
    expect(linear.nav.canDrop(1), '线性历史的中间提交可摘').toBe(true);
    expect(linear.nav.canDrop(2), '根提交不可摘').toBe(false);
  });

  it('空输入：返回空模型，不抛错', () => {
    const model = buildLayout([], { head: null });
    expect(model.paths).toStrictEqual([]);
    expect(model.points).toStrictEqual([]);
    expect(model.contentWidth, '2*insetX - grid.x').toBe(16);
    expect(model.height).toBe(0);
    expect(model.nav.firstParent(0)).toBe(-1);
  });

  it('stash 内部段不会吞并普通父提交（普通提交必须有正常颜色槽）', () => {
    const commits = [
      {
        ...commit('I', ['B']),
        stashInternal: { selector: 'stash@{0}', kind: 'index' as const },
      },
      commit('B'),
    ];
    const model = buildLayout(commits, { head: 'B' });
    expect(model.points[0].colour, '内部提交本身仍是灰色').toBe(GREY);
    expect(model.rowSlots[1], '普通提交不能被内部段占成 -1 槽').not.toBe(-1);
    expect(model.points[1].colour, '普通提交要有正常颜色').toBe(PALETTE[0]);
  });

  it('自引用父提交不会画出多余路径或撑宽图谱', () => {
    const commits = [commit('A', ['B', 'A']), commit('B'), commit('C')];
    const model = buildLayout(commits, { head: 'A' });
    expect(model.contentWidth, '自引用边不得额外占列').toBe(32);
    expect(model.rowWidths).toStrictEqual([30, 30, 30]);
    expect(model.paths.length <= 2, `自引用不应产生多余路径，实际 ${model.paths.length}`).toBe(
      true,
    );
  });
});

/** 黄金基准 fixture 的结构（runtime 数据来自 graph-golden.json，原样复制）。 */
interface GoldenPath {
  d: string;
  colour: string;
  committed: boolean;
  dashed: boolean;
}

interface GoldenPoint {
  x: number;
  y: number;
  colour: string;
  current: boolean;
  stash: boolean;
  stashInternal: boolean;
  committed: boolean;
}

interface GoldenCase {
  name: string;
  commits: Commit[];
  options: {
    head: string;
    expandedRow: number;
    firstParentOnly: boolean;
    muteMerges: boolean;
    style: 'rounded' | 'angular';
  };
  expected: {
    rowWidths: number[];
    rowSlots: number[];
    muted: boolean[];
    contentWidth: number;
    height: number;
    paths: GoldenPath[];
    points: GoldenPoint[];
  };
}

interface GoldenFixture {
  version: number;
  cases: GoldenCase[];
}

const golden = JSON.parse(
  await readFile(new URL('./fixtures/graph-golden.json', import.meta.url), 'utf8'),
) as GoldenFixture;

const projectPath = (p: GoldenPath): GoldenPath => ({
  d: p.d,
  colour: p.colour,
  committed: p.committed,
  dashed: p.dashed,
});

const projectPoint = (p: GoldenPoint): GoldenPoint => ({
  x: p.x,
  y: p.y,
  colour: p.colour,
  current: p.current,
  stash: p.stash,
  stashInternal: p.stashInternal,
  committed: p.committed,
});

for (const c of golden.cases) {
  it(`黄金基准：${c.name}`, () => {
    const model = buildLayout(c.commits, {
      head: c.options.head,
      expandedRow: c.options.expandedRow,
      firstParentOnly: c.options.firstParentOnly,
      muteMerges: c.options.muteMerges,
      style: c.options.style,
    });

    expect(model.rowWidths, '逐行图宽必须与基准一致').toStrictEqual(c.expected.rowWidths);
    expect(model.rowSlots, '每行颜色槽必须与基准一致').toStrictEqual(c.expected.rowSlots);
    expect(model.muted, '灰化行必须与基准一致').toStrictEqual(c.expected.muted);
    expect(model.contentWidth, '内容宽必须与基准一致').toBe(c.expected.contentWidth);
    expect(model.height, '总高必须与基准一致').toBe(c.expected.height);
    expect(
      model.paths.map(projectPath),
      '路径（d 串/颜色/虚线）必须一致',
    ).toStrictEqual(c.expected.paths);
    expect(
      model.points.map(projectPoint),
      '圆点坐标与样式必须一致',
    ).toStrictEqual(c.expected.points);
  });
}
