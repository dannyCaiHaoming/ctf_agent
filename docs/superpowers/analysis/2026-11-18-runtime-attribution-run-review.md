# Python 运行时阻断归因：3 次 ezoj run 的复盘明细

本文保存 [B design §7.2](../specs/2026-10-26-design-v1-b-method-generalization-and-efficiency.md#72-python-运行时阻断归因) 的逐次时间线、核对过程与停止规则观察；design 只保留结论。计数见 [runtime-diag-20261117](../../gates/runtime-diag-20261117/summary.json) 与 [runtime-diag-20261117-r2](../../gates/runtime-diag-20261117-r2/summary.json)。

核对方式：只用 `inventory.json`、control-audit、progress note、工作簿 sqlite 计数、派单与交回文字的关键词布尔值和位置，以及历史 run 的派单计数；未读 transcript，不重放请求。

## 1. 条件与结果

共同条件：ezoj、arm=on、deepseek-v4.1-flash、Solver 开思考、30 分钟／5M token、经验库为空、learning 关闭。3 次都无候选、无打包、无裁判回执。

| run | head | 用量 | 结果 |
| --- | --- | --- | --- |
| `rtd-ezoj-on-1` | `13a93056`（指向行在「開始前」） | 96 次调用、约 35 万 token、19.5 分钟 | Solver 0 次载入；13.2 分钟把部署不一致写成判定（seq 72、73）；Coordinator 问题 65 预设部署不一致的结论；Critic 14.3 分钟载入并改正；剩 10 分钟 |
| `rtd2-ezoj-on-1` | `fe56cedd`（含 `e8d9d76f`） | 116 次调用、约 98 万 token、27.0 分钟 | Solver 0 次载入；没有写出部署／环境／不可解归因；4.1 分钟遇到 RuntimeError，25.8 分钟记录 PermissionError；无 Critic；剩 3 分钟 |
| `rtd2-ezoj-on-2` | 同上 | 110 次调用、约 51 万 token、27.8 分钟 | 见 §2 时间线；剩 2 分钟，最终 note 把部署不一致写成 blocker |

`rtd2` 两次 `--check` 的输出未单独保存，只由 `batch-meta.json` 的 precheck 与 exit 0 间接确认；目标容器原为 exited 137，重启后运行。

## 2. `rtd2-ezoj-on-2` 的承接时间线

| 分钟 | 事件 |
| --- | --- |
| 16.30 | Solver 第一轮记录 `PermissionError`（seq 123） |
| 16.40 | 写出部署不一致的开放假设（seq 128），未并列其他层 |
| 16.45 | 写问题（seq 129） |
| 16.49 | 载入 `python-runtime-diagnosis`，只载入 SKILL.md，未读 Reference |
| 16.54 | 输出交回文字，含并列解释与保留措辞；载入后没有再写工作簿，seq 128 未改 |
| 16.66 | 第一轮交回完成；交回文字含该 Skill 名，16.67 送达 Coordinator |
| 17.32 | Coordinator 新建 Solver 任务（不带 `task_id`），派单问“部署不一致是否为唯一解释”，未点名 Skill |
| 23.72 | 第二轮以 seq 147 取代 seq 128，升级为 supported，文字含“唯一解释”；该 session 未载入 Skill、未读 Reference |
| 24.33 | 派 Critic，未载入 Skill；Critic 限定 seq 147，route=redirect |
| 27.71 | 最终 note：stop_and_report，部署不一致作为 blocker，无保留措辞 |

## 3. Solver 载入行为的核对

- **已排除：** 资产已送到（run 内 `domain-solver.md` 含指向行，Skill 目录已复制，inventory 列出）；权限允许（Solver 与 Critic 的 `skill` 规则相同，Critic 调用成功）；prompt 完整（2139 字，与角色档正文一致）；模型未换（Solver 曾调用 skill 的 r3、r4 同为 DeepSeek v4.1 flash，端点不同）。
- **基础率：** 56 个有 control-audit 的 run 中，Solver 只在 2 个 run 调用过 `skill`（10-25 r3、10-26 r4），之后约 45 个 run 为 0；`recon.md` 自 10-29 起按名指向 `recon-investigation`，此后 Recon 只载入 2 次，都在 session 开始约 0.5 分钟。
- **上批：** 指向行在「開始前」，权限失败出现在第 7.08 分钟、Solver 第 18 次 `job.run` 循环里；Solver 第二轮派单含「部署」、不含复核措辞，承接 Coordinator 的问题 65，Solver 在 13.2 分钟写成判定；Critic 的派单以待复核的结论提出，Critic 载入。
- **本批：** 唯一一次载入紧贴交回（§2）。

## 4. Coordinator 未点名的核对

- **已排除：** 两次 run 内 `coordinator.md` 与仓库逐字节相同，点名子句在第 30 行，未截断；`rtd2-ezoj-on-2` 16.68 分钟约 1.4 万字的推理含 Python 与运行时，`rtd2-ezoj-on-1` 自 16 分钟起各段推理与派单含 Python；`rtd2-ezoj-on-2` 第一轮交回文字含 Skill 名，0.65 分钟后的派单仍未点名。
- **观察：** 两次 run 的 Coordinator 推理、文字与派单中“Skill”一词 0 次；12 次 Solver 派单点名 0 次。当时 `coordinator.md` 只有两处提到 Skill：「有界回合」第二个例子的后半句，以及把新增 Skill 记为 `capabilityGap`。同一行前半句（不预设结论）被部分采用。
- **基础率：** 历史 run 中 58 个 Coordinator session、384 次派单，点名任何 Skill 的 3 次，分在 3 个 run。
- **续接：** `rtd2-ezoj-on-1` 第一轮后 7 次 Solver 派单都带 `task_id`；`rtd2-ezoj-on-2` 4 次都不带，每次先 `ctf_challenge_assign` 再新建任务。当时角色档只写了怎么续接，没写何时续接。

## 5. 停止规则的变更后观察

3 次 run 都在 `63b3633f`／`e625024d` 之后，是[团队决策 §6.3](../specs/2026-11-07-design-v1-team-decision-context.md#63-候選與收尾) 停止规则的首批变更后样本。

| run | 剩余分钟 | Critic | 最终 note 与 open 条目 |
| --- | ---: | --- | --- |
| `rtd-ezoj-on-1` | 10 | 12.6–15.0 分钟与 Solver 第二轮并行，建议 continue 并给 10 分钟计划；Coordinator 只续一轮 3.5 分钟便停止 | 说明了 Solver 的 open 假设 60、61，未说明 Recon 的 open 假设 25、26 |
| `rtd2-ezoj-on-1` | 3 | 未派 | 未说明假设 27、问题 30 |
| `rtd2-ezoj-on-2` | 2 | redirect 后补查两轮（1.0、1.5 分钟） | 声称“全部 open 问题已关闭”，但问题 1 与假设 54 仍 open；假设 53、147 为 supported、未被取代，只引用了 147 |

上批 Solver 三轮用时 8.2、0.8、3.5 分钟（按 task.completion 的 childID 对应）。
