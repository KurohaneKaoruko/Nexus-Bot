# API-06：Agent、ActionPlan 与 ActionBroker

## 6.1 职责分离

- `Agent` 读取已分配任务，提出本 Tick 的候选行动。
- `ActionBroker` 解析目标，执行前置条件检查，按可验证规则处理同 Tick 冲突，再调用原生 API。
- `ActionResult` 记录返回码与后续验证条件。
- 下一个 Tick 的 `Perception` / 任务完成检查决定目标结果是否实际成立。

Agent 不直接持久化动作闭包，不通过“先调用一次 API、失败后另一模块又调用一次”的方式分散行动控制。

## 6.2 ActionPlan 公共类型

```ts
export type ActionKind =
  | "move" | "harvest" | "pickup" | "withdraw" | "transfer"
  | "build" | "repair" | "upgradeController" | "dismantle"
  | "attack" | "rangedAttack" | "rangedMassAttack" | "heal" | "rangedHeal"
  | "claimController" | "reserveController" | "attackController"
  | "signController" | "boost" | "usePower" | "structureAction";

export interface ActionPlan {
  id: string;
  tick: number;
  taskId: string;
  actorName: string;
  kind: ActionKind;
  targetId?: string;
  targetPos?: SerializedPosition;
  resourceType?: ResourceConstant;
  amount?: number;
  priority: number;
  issuedBy: string;
  expectedPipeline: ActionPipeline;
  dedupeKey: string;
}

export type ActionPipeline =
  | "move" | "work" | "carry" | "melee" | "ranged"
  | "heal" | "controller" | "structure" | "power";
```

这是项目内部的数据传输协议，不是原生 Screeps API 的输入类型。对 `kind` 使用判别联合类型应比 `{ method: string; args: any[] }` 更安全。

## 6.3 ActionBroker API

```ts
export interface ActionValidation {
  allowed: boolean;
  reason?: string;
  nativeCode?: number;
}

export interface ActionResult {
  planId: string;
  tick: number;
  accepted: boolean;
  nativeReturnCode: number;
  category: "accepted" | "retryable" | "replan" | "invalid" | "suppressed";
  reason?: string;
}

export interface ActionBroker {
  submit(plan: ActionPlan): void;
  validate(plan: ActionPlan, ctx: TickContext): ActionValidation;
  commit(ctx: TickContext): readonly ActionResult[];
  lastResult(actorName: string, pipeline?: ActionPipeline): ActionResult | undefined;
}
```

`submit` 只登记计划，不应执行原生 API。`commit` 统一排序、校验和提交。若采用更小的架构，也可以把 submit/commit 实现为一个执行函数，但接口语义仍应保持“先决策、再集中提交”。

## 6.4 行动前检查

按动作种类执行必要检查，不要套用一组过于粗糙的通用条件：

- Actor 是否存在、是本方单位且未处于不允许行动的生成状态？
- 任务是否仍在有效 lease 内，并且归属 actor？
- Target ID 是否能解析到当前 Tick 对象；目标类型是否与动作匹配？
- Actor 的身体部件/资源/冷却/疲劳/负载是否支持该动作？
- 需要近距离的动作是否在范围内？若不在范围内，应产生移动计划，而不是不断重复产生不可执行的工作行动。
- 资源数量、目标容量和结构状态是否满足？
- 房间控制等级、拥有权、权限、目标可见性等条件是否满足？
- 同一行动管线是否已存在冲突计划？重复相同计划是否可以合并？

这些是“减少无效命令”的前置检查；原生 API 返回码仍是最终提交反馈。

## 6.5 行动冲突不能用“一单位一行动”简化

Screeps 有多个行动管线。某些同 Tick 行动可并行，某些行动之间存在调用优先级；重复同类行动的调用顺序可能影响最终提交的意图。请依据官方[同时行动规则](https://docs.screeps.com/simultaneous-actions.html)维护 `ActionPipeline` 规则集，并为规则编写测试。

要求：

- 不采用“每只 Creep 每 Tick 只能执行一个行动”的错误全局限制。
- 也不允许“每个模块都可随意调用任何动作”造成未定义覆盖。
- 具体 pipeline 归类必须根据当前官方 API/规则验证。对于 PowerCreep、特殊结构和之后新增的行为，新增独立规则并进行版本测试。
- 同一 actor + pipeline 的候选计划应有稳定的去重和仲裁；多个不同 actor 争夺同一目标时，额外考虑目标容量和拥堵。

## 6.6 返回码分流

不要统一把 `result !== OK` 当成致命错误。

| 错误类别 | 典型处置 | 不应做的事 |
|---|---|---|
| 超出距离 | 提交移动计划或更换位置/目标 | 原地无限重试同一动作 |
| 目标失效 | 重新感知、删除目标、释放任务 | 继续使用失效对象引用 |
| 能源/资源不足 | 等待补给、改派物流、调低请求 | 反复创建同一失败计划 |
| 接收方已满 | 重选存储/消费者 | 对满目标持续 transfer |
| 冷却或疲劳 | 延迟重试、进行可用的其他动作 | 在每个 Tick 反复付出同一规划成本 |
| 身体能力不足 | 重新分配或请求正确身体 | 期待同一单位以后自然获得缺失部件 |
| 所有权/RCL/GCL/参数错误 | 识别为策略/配置错误并记录 | 当作临时失败无限重试 |
| 未知负码 | 保留实际码、计数、限频上报 | 静默吞掉 |

必须由 `@types/screeps` 和当前 API 引用核对每个方法的返回类型与可能返回码，不要仅靠此分类反向假设某方法一定会返回表中的每个码。

## 6.7 移动建议

移动应走 `NavigationService`，不要把多个独立 `moveTo` 路径策略塞进不同角色脚本。导航计划须指定：目的地范围、路径权重策略、危险约束、缓存策略和重规划触发条件。成功提交移动意图不等于当前 Tick `creep.pos` 立刻变化；任务推进要在后续 Tick 通过新位置验证。
