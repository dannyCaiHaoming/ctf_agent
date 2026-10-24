# Critic 信号离线核对

2026-10-25；主会话只读核对，未运行模型／目标，未改产品代码。

## 结果

`inspect.py` 从原始 R 的 progress.jsonl 与 root messages 提取元数据，结果 observations.json。不读取 reasoning 字段内容，不输出 prompt/body/argv。Coordinator 当前文件与 run 固定副本 SHA-256 相同：6f06eaffc605a8e4fc5ed584f606fdd9b713be4518a4c9871a510cb7b2c88060；Critic 同为440ef091d1c2e6c3af7412b32b281637bbec90388fa6a2b593ca1a62b7e52eee。

- Root 调用 progress.read **0 次**，task(recovery-critic) **0 次**，progress.note **1 次**（seq807）。没有证据表明重复摘要被本次Coordinator实际读取。
- 四个后台通知是seq258/647/785/793；各消息存在于root保存记录。因此原始空/短task_result可到达父上下文，不应写为“父完全看不到交接”。但包络不含finish=length、source message ID或完整性结论。
- 在上述四处及seq807之前，按当前 digest 的分组键(tool+argFingerprint)重建计数，均无达到 Coordinator 三次触发阈值的组；digest 本身从 count>=2 开始返回，这不表示其 repeated 列表为空。不能将7次语义不同的task恢复概括为已满足“相同工具参数三次”触发；现有计数也不判断结果是否有新知识。
- publication等为空能证明没有可信产物，不证明7次恢复没有有用text。故连续两次没有artifact并不独立证明语义停滞；本文不据此保证调用Critic必然解决问题。
- `control-service.ts:27`允许Coordinator分派Critic，:531-535返回progressDigest，:608校验Coordinator/Critic权限；产品opencode.json允许相应工具。`progress-ledger.ts:294-326`只在读取时按全audit的tool/fingerprint计算重复、返回recent/latest notes，没有自动推送、每交接完整性统计或episode去重。静态权限和逻辑存在不等于本run调用成功，因本次无调用证据。
- Coordinator第26-27行已列触发条件且“可按需要”读取；Critic不介入不能单独归因于漏写条件或工具故障。本次没有选择A增加重复提示词的证据。

## 建议边界

选择B仅限已证实缺少的交接完整性事实，并入子任务完整性改动：将原始finish与报告为空/未完整/unknown告知父会话。保持Critic/Coordinator语义判断；不另加自动Critic调度器、重复指纹监控、强制每两交接调用或新权限。没有独立充分证据要求本轮修改Critic文案或progress重复规则。对complete产物语义质量、何时Critic有效仍为模型遵循未验证。

## 验证层次与限制

这是保存轨迹+源码/资产hash核对；没有运行Critic原生调用，无需将接口假设误写已验。原始证据位置与hash在observations.json。无新增测试或新判定器；可重跑命令：python3 inspect.py（原始R必须仍存在）。后续若检验行为，另需预算授权，当前不恢复真实调试。
