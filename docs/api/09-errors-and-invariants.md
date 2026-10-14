# API-09：错误码、重试策略与系统不变量

## 9.1 首要原则

Screeps 原生 API 方法通常返回具名的成功/错误常量。不要只根据数字猜原因；以对应方法的官方说明和类型定义为准。错误码常量是全局 API 的一部分，应直接引用具名常量而不是在业务代码里写 `-9` 等魔法数字。

## 9.2 常见返回结果的处理类别

下表是分类策略，不是声称任意 API 方法都会返回每一个码。每个调用点仍应针对其官方文档验证具体可能返回值。

| 类别 | 典型例子（按原生常量名） | 处理方式 |
|---|---|---|
| 成功提交 | `OK` | 记录被接受；后续仍需确认结果是否达成 |
| 所有权/权限 | `ERR_NOT_OWNER` | 策略或目标选择错误；重新评估控制权 |
| 路径/目标 | `ERR_NO_PATH`、`ERR_NOT_FOUND`、`ERR_INVALID_TARGET` | 重建目标/路线或终止任务 |
| 名称/忙碌 | `ERR_NAME_EXISTS`、`ERR_BUSY` | 生成新名或等待当前生产/动作结束 |
| 资源/容量 | `ERR_NOT_ENOUGH_RESOURCES`、`ERR_FULL` | 等待补给、重选接收者、调整请求量 |
| 距离/参数 | `ERR_NOT_IN_RANGE`、`ERR_INVALID_ARGS` | 产生移动计划或视为参数/实现错误 |
| 冷却/疲劳 | `ERR_TIRED` | 延迟该行动并执行其他合法任务 |
| 身体能力 | `ERR_NO_BODYPART` | 重新分配任务或修复 BodyFactory 规则 |
| Controller/控制级别 | `ERR_RCL_NOT_ENOUGH`、`ERR_GCL_NOT_ENOUGH` | 调整战略条件，避免无限重试 |

某些版本可能保留兼容别名；不要在新代码中把两个别名常量当作不同的业务原因。实际数字也不应该持久化为语义状态，存 `failureCategory` 和 `nativeCode` 即可。

## 9.3 Retry Policy

```ts
export interface RetryPolicy {
  maxAttempts: number;
  initialDelayTicks: number;
  maxDelayTicks: number;
  multiplier: number;
  retryableCategories: string[];
}
```

要求：

- 对同样错误使用退避，避免每 Tick 付出昂贵计划成本。
- 对目标失效、权限错误和缺失能力等结构性错误，不应无限重试。
- 每次重试前重新检查状态；资源和目标在后续 Tick 会变化。
- 每次最终失败都要释放 lease 与相关资源预留。
- 对关键任务可升级优先级或通知上层战略，而非反复原地执行。

## 9.4 核心不变量清单

1. 任何跨 Tick 的数据均是可序列化 DTO，不存运行时对象或闭包。
2. 每个活跃任务最多有一个有效 owner；需要多人协作时用显式的成员列表/容量规则。
3. `ActionBroker` 是所有可控行动的统一提交边界。
4. 每个可重试任务拥有最大尝试数或明确的永久任务策略。
5. 每笔资源预留都有 owner、数量、创建时间、过期时间和释放路径。
6. 所有未知/旧 Intel 都带时间戳，不得伪装为当前视野。
7. 所有需要跨 Tick 的目标均使用 ID 或位置 DTO，不保存原生对象引用。
8. Spawn、Terminal、Lab、Factory 与结构行为必须以官方返回码和当前动态状态为准。
9. 每个模块能在 CPU 不足时跳过或缩小工作量；跳过需要被统计。
10. 不允许一个子模块的意外异常使全部经济和防御行为停止。
11. 对 API 的假设变更必须有测试与文档记录。
12. 测试不能只确认“不报错”，还要确认目标进展、资源守恒和长期稳定性。
