# Nexus-Bot 协作与发布规范

> **目的**：让多个 Agent（或人 + Agent 混合）在同一仓库上并行推进而不互相踩踏，并规定代码如何合入与发布。
> **适用范围**：Nexus-Bot 全部代码、文档、测试、场景与配置。
> **上位约束**：`AGENTS.md`（先修 bug 再开发、范围隔离、不擅自提交、禁硬编码）。本文件只规定**协作流程与发布流程**，不覆盖 `AGENTS.md`。
> 与设计文档（`./docs/nexus-design`）、API 契约（`./docs/api`）、缺陷清单（`./docs/bugs`）、变更规格（`./openspec`）分开维护，互不混放。

---

# 第一部分：分支与发布规范

## 1.1 分支模型

`main`（发布线）与 `dev`（集成分支）是**两条独立历史线**（无共同祖先）；开发分支（`feat/*`、`fix/*`、`chore/*`）从 `dev` 切出。

### `main`：只放发布版本

- 不直接开发、不直接提交。
- 每个提交就是一个发布版本，提交信息即版本号：`init` → `0.1.0` → `0.1.1` → …
- `init` 是**空提交**（仓库根，不含内容）；其后每个版本提交是当次发布内容的完整快照，其**树 = 发布时 `dev` 的树**。
- 历史必须是直线：禁止 merge 提交，禁止改写任何已发布的版本提交。

### `dev`：集成分支，保留完整开发历史

- 日常开发成果汇总到这里，是唯一允许向 `main` 发布的分支。
- 开发分支并入 `dev` **一律用 rebase**：先 `git rebase dev <branch>`，再 `git merge --ff-only <branch>`，保持 `dev` 线性、无 merge 提交。
- **只向前推进**：不回退、不 rebase 到 `main`、不改写已推送的提交。已发布内容由 `main` 的版本提交承载，`dev` 无需重定位。
- 未经验证的 `dev` 禁止发布到 `main`。

### 开发分支

- 命名：`feat/<主题>`、`fix/<主题>`、`chore/<主题>`。
- 一律从 `dev` 切出，完成后 rebase 回 `dev`。

## 1.2 发布流程（`dev` → `main`）

1. `dev` 上的改动通过验证（见 §2.6 完成定义）；涉及 sim 可验证行为须附 sim 回归结论。
2. 在 `dev` 上升 `package.json` 的 `version` 并提交。
3. 切到 `main`，把 `main` 的树**快照为 `dev` 的当前树**，提交为新版本：

   ```bash
   git checkout main
   git read-tree -u --reset dev   # 索引与工作区精确变为 dev 的树
   git commit -m "<版本号>"
   ```

   > `dev` 与 `main` 无共同祖先，`git merge --squash dev` 会因 add/add 冲突失败，故用 `read-tree` 快照。该提交的 diff 即「上次发布以来 `dev` 的增量」。

4. 打标签并推送：`git tag v<版本号> && git push origin main --tags`。
5. `dev` 不动，继续在自己的最新提交上向前开发；下次发布重复 1–4，`main` 上每次只增一个版本提交。

## 1.3 硬约束

- **禁止**把开发分支直接合并到 `main`；必须经 `dev` 汇总后压缩发布。
- **禁止**在 `main` 上提交非发布内容；**禁止** rebase / 改写 `main` 已发布的历史。
- **`dev` 与 `main` 互不改写**：`dev` 不 rebase 到 `main`、不丢弃自身历史；`main` 不 merge 回 `dev`。两者只通过「发布快照」单向同步。
- **禁止强推 `main`**；`dev` 在 rebase 开发分支后如需强推，必须用 `--force-with-lease`。
- `main` 上的发布提交信息**必须**是纯版本号（`init` / `0.1.0` / `0.1.1`），不带前缀、不带描述。

## 1.4 提交规范

- 提交身份：`KurohaneKaoruko <kurohanekaoruko@gmail.com>`（author 与 committer 保持一致）。
- 提交信息格式：`<type>: <一句话>`，`type` ∈ `feat` / `fix` / `docs` / `sim` / `refactor` / `chore`。
- 提交前必须跑完 §2.6 完成定义的全部门禁，并在提交信息或 PR 描述中附验证输出。
- 禁止把环境相关信息（本机路径、密钥位置、私服地址与凭据）写入本文件或任何入库文件。

---

# 第二部分：多 Agent 并行协作规范

## 2.1 三条铁律

1. **先修 bug，再开发新功能。** `./docs/bugs` 中存在未修复的 P0/P1 缺陷时，禁止开始新功能开发。
2. **文档与代码同 Tick 更新。** 改了行为就必须改对应文档；文档里引用的文件必须真实存在（曾出现 `defense/index.ts` 被引用但不存在的情况）。
3. **不擅自提交。** 未经明确指示不得 `git commit` / `git push`。开发在特性分支上进行，保持工作区可审查。

## 2.2 单一事实源（Single Source of Truth）

每个"事实"只能有一个权威位置。**禁止在第二个地方复制它**。

| 事实 | 唯一权威位置 | 禁止 |
|---|---|---|
| 模块清单与执行序 | `src/modules/index.ts` 的 `createDefaultModules()` | 文档里手写"当前模块列表"却不注明来源 |
| 阶段顺序 | `src/core/phases.ts` 的 `TICK_PHASES` | 在文档里另列一套阶段序 |
| 任务类型与优先级 | `src/store/taskSchema.ts`（`TASK_KINDS` / `TASK_PRIORITY` / `LEASE_POLICY`） | 模块内硬编码任务优先级 |
| 可调参数 | `src/config/*.ts` | 任何模块内的魔法数 |
| Memory 结构 | `src/store/memorySchema.ts`（+ `migrations.ts`） | 在模块内定义持久化字段形状 |
| 行动种类与管线 | `src/modules/agents/actionBroker.ts` | 模块内直接调用游戏行动 API |
| 缺陷清单与状态 | `./docs/bugs/*.md` | 把缺陷记进设计文档 |
| 设计契约 | `./docs/nexus-design/*.md` + `./openspec/changes/*` | 把设计写进代码注释（注释只描述代码本身） |
| 分支与发布流程 | 本文件第一部分 | 在别处另列一套分支/发布规则 |

## 2.3 文件所有权与并行切分

**并行单元 = 一个文件（或一个目录）**。两个 Agent 不应同时改同一文件；若必须，走 §2.5 交接。

| 分区 | 目录/文件 | 典型改动者 |
|---|---|---|
| 内核 | `src/core/*` | 内核维护者 |
| 存储 | `src/store/*` | 内核维护者 |
| 配置 | `src/config/*` | 对应领域维护者 |
| 经济域 | `src/modules/economy/*` | 经济 Agent |
| 防御域 | `src/modules/defense/*` | 防御 Agent |
| 集群域 | `src/modules/cluster/*` | 集群 Agent |
| 生产/单位 | `src/modules/spawning/*`、`src/modules/agents/*` | 单位层 Agent |
| 导航 | `src/modules/movement/*` | 导航 Agent |
| 设计文档 | `docs/nexus-design/*` | 各域维护者（按章节分工） |
| API 契约 | `docs/api/*` | 内核维护者 |
| 缺陷清单 | `docs/bugs/*` | 各域维护者 |
| 测试 | `tests/<同域>/` | 与实现同属一个 Agent（**不得只改实现不改测试**） |

**跨域改动的边界规则**：

- 需要改 `src/store/*` 或 `src/core/*`（共享契约）时，**必须先改文档（`docs/nexus-design/03`、`04` 或 `20`）再改代码**，并在 PR/交接单中标注为"契约变更"。
- 跨域调用只允许走**已登记的接口**（`requestSquad`、`TickContext.directive()`、共享账本、TaskBoard）。新增跨域接口必须先在对应设计文档章节登记。

## 2.4 接口冻结与变更流程

**冻结接口**（改动成本高，需协调）：

| 接口 | 位置 | 冻结内容 |
|---|---|---|
| `TickContext` | `src/core/tickContext.ts` | 字段集合与语义 |
| `TickModule` | `src/core/scheduler.ts` | `{name, phase, band, run}` |
| `TaskBoard` | `src/modules/tasks/board.ts` | 方法签名与不变量 |
| `ActionBroker` | `src/modules/agents/actionBroker.ts` | `submit/commit/lastResult` 语义 |
| `NexusMemory` | `src/store/memorySchema.ts` | 子系统键与字段 |
| `SquadRequest` / `SquadRecord` | `src/store/runtime.ts` / `memorySchema.ts` | 集群层对外契约 |

**变更流程（四步，缺一不可）**：

1. **声明**：在交接单写明"要改哪个冻结接口、为什么、影响哪些调用方"。
2. **同步文档**：更新对应设计文档章节（含 `docs/nexus-design/20` 的接口契约表）。
3. **同步迁移**：若涉及 Memory 字段 → `CURRENT_SCHEMA_VERSION` +1 + 新增纯函数迁移 + 迁移测试（旧版本 → 新版本 → 幂等）。
4. **同步测试**：新增/更新单测；涉及跨模块行为时补集成测试。

## 2.5 交接协议（Handoff）

任何"我做完了一部分，剩下交给你"的交接，必须给出以下**五要素**（缺一即视为未完成交接）：

```markdown
## 交接单

- **范围**：涉及的文件（绝对路径或仓库相对路径）
- **状态**：已完成 / 部分完成（明确到函数或行）/ 未开始
- **接口**：我对外暴露了什么、我依赖了什么（函数签名原样粘贴）
- **验证**：我跑了什么命令、结果如何（贴关键输出，不要只写"通过"）
- **遗留**：我知道但没做的事，以及为什么不做（含风险与建议下一步）
```

**禁止**在交接单里写"根据我的发现继续修"——接手方没有你的上下文，必须给出具体文件与具体改动点。

## 2.6 完成定义（DoD）

一个任务只有同时满足以下条件才算完成：

- [ ] `node node_modules/typescript/bin/tsc --noEmit` 通过（源码）
- [ ] `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.test.json` 通过（测试）
- [ ] `node node_modules/vitest/vitest.mjs run` 全绿（**禁止**为了让测试通过而放宽断言；若断言过宽，先修正断言再修实现）
- [ ] `node node_modules/rolldown/bin/cli.mjs -c` 构建成功，且产物体积变化有说明
- [ ] 新增行为有对应单测；修改行为有对应测试更新
- [ ] 对应设计文档章节已更新（含进度表勾选）
- [ ] 无硬编码（参数进 `src/config/*`）、无敏感信息、无参考来源注释
- [ ] 若涉及 sim 可验证的行为 → 附 sim 回归结论；**未跑就写"待验证"，不得写"已验证"**

> Windows 环境下 `npm run build` / `npm test` 会因 PATH 找不到 `.bin` 而失败，使用上面的 `node node_modules/...` 直调形式。
> 首次在 Windows 上工作需补装原生二进制（见 `docs/nexus-design/20-智能连结集群.md` §20.7.3）。
> **sim 当前不可构建**：`sim/` 的 `v8` crate 取不到 `librusty_v8.a`（GitHub Release 不可达、无镜像、本机无 clang）。因此涉及 sim 的行为**只能**用 `tests/cluster/e2e.test.ts` 式的集成测试或私服验证替代，交接单里必须如实写"未跑 sim"。

## 2.7 冲突与仲裁规则

| 冲突 | 处理 |
|---|---|
| 两个 Agent 改了同一文件 | **后动手的一方回退**，重新按 §2.5 交接；不得"顺手合并" |
| 设计文档与实现不一致 | 以 `./docs/nexus-design` 为准（`AGENTS.md`）；先改实现或先改文档，但必须让二者一致并在进度表标注 |
| 文档冲突（总体 vs 领域） | 更专门者优先：领域文档优先于总体文档；同时修正总体文档的引用 |
| 测试与实现冲突 | 先判断哪个符合设计；若设计未定义，**新增设计说明再定**，禁止"改测试迁就实现" |
| 性能优化与可读性冲突 | 可读性优先；优化需有指标证据（`docs/nexus-design/02` 原则 F） |

## 2.8 缺陷与变更文档规范

**缺陷**（`./docs/bugs/*.md`）：

```markdown
## P<优先级>-<序号> <一句话现象>

**状态**: ⏳ 未修复 / ✅ 已修复 (<日期>)
**现象**: 可观测事实（数字、日志、坐标）
**根因**: 从现象到代码的因果链（含文件:行）
**修复**: 具体改动点（文件 + 做法）
**验证**: 命令 + 通过标准（必须是可复现的判据）
```

**变更**（`./openspec/changes/<change>/`）：`proposal.md`（问题与范围）/ `design.md`（方案与权衡）/ `tasks.md`（勾选清单，每项带验证方式）/ `specs/<capability>/spec.md`（能力规格）。

## 2.9 反模式清单（见到就退回）

1. 为让测试变绿而放宽/删除断言。
2. 在模块内写魔法数而不进 `src/config/*`。
3. 新建"通用事件总线 / 插件框架 / 中间层"却没有第二个使用方。
4. 把设计说明写进代码注释，或把缺陷写进设计文档。
5. 复制一份模块清单/阶段序到文档里（应引用唯一权威位置）。
6. 未验证就写"已验证"。
7. 直接调用游戏行动 API（必须经 ActionBroker）。
8. 把游戏 API 对象写进 `Memory`。
