# M1B 0.3：host cursor 与上下文测量本地记录

日期：2026-10-20。工作区：`/Users/caihaoming/Documents/pentest-agent`，分支 `main`。

文档整理先独立提交为 `443899d`，确认工作区干净后才开始实施。用户授权范围为 host 管 cursor、上下文构成测量及必要本地测试。本次真实模型调用为零；未复跑 DVGA，未实施裁剪或 compaction，也未恢复⑤⑥③④工作。

## 改动与本地证据

- `observation.read` 输入变为 `{ ref, mode?: 'continue' | 'start', max_bytes? }`。默认继续该 ref；host 保存 cursor，成功发布片段并登记 canonical 结果后才推进。返回的 cursor/range 仍保留，作为读取证据；它们不再是模型必须回传的参数。
- plugin schema、工具描述和 Web prompt 同步移除输入 cursor。输入旧 cursor 被 strict schema 拒绝，不能覆盖 host 状态。
- 同一 ref 在途读取拒绝并发请求，避免两个调用在 await 期间重复领取同一片段。失败释放在途标记且不跳过数据。不同 ref 各自推进；显式 start 从零读取。
- 原有本地 OpenCode provider 接线测试改成连续两次只传 ref，验证页范围 2048→3072→4096，provider 侧工具 schema 无 cursor。该测试没有调用外部模型。
- 额外 host 测试覆盖独立 ref、并发保护、UTF-8 边界、无进展读取失败、旧 cursor/未知 ref 拒绝、失败后继续、显式 start、EOF。未新增题目 fixture 或 gate。

TDD：无 cursor 的接线测试在实现前因必填 cursor 失败；同 ref 并发测试在保护实现前观察到两个请求均成功，随后实现保护并通过。其余正负断言用于验证 host 推进与测量边界。

## 上下文构成的测量口径

仅通用 Web 路径记录；复用现有 plugin 的 model.input/model.system/model.call hooks 与 canonical `driver.call`，没有新增 Agent 循环或日志服务。

每次 model.input 检查数据与 session 后，对 hook 可见的每个 message part 做 JSON UTF-8 字节计数，保存为下一次 driver.call 的 `context_measurement`：

| 字段 | 含义与限制 |
| --- | --- |
| `method=utf8-json-bytes/v1` | 统计 OpenCode message parts 的序列化字节，含 part 元数据；不是 provider 最终 wire payload 大小，也不是 token |
| `working_set` | 保留全部 user text，以及最近两个 assistant messages 中的 text/reasoning/已完成 tool parts；这是年龄规则下的候选工作集，不是语义充分性结论 |
| `history_candidate` | 更早 assistant 的 text/reasoning/已完成 tool parts；包含旧观察、自述及调用信息。仅为可能可移除历史，不能证明其中没有未决问题或必要结论 |
| `unclassified` | 其他 part，包括文件、非完成工具状态、未知类型；不把无法分类内容当作可丢弃 |
| `system_bytes` | system hook 可见 JSON 的字节数，单列；未收到则 null |
| `tool_schema_bytes` / `token_estimate` | 当前 hook 未给出完整 provider 工具序列化/token 分项，记 null，不捏造数字 |
| `counterfactual` | 仅从 parts_bytes 减掉 history_candidate 字节，得到保留部分与比例；保留 unclassified，`applied=false`。这不是裁剪后的实际 token 或请求 |
| `prior_usage_message_ids` | 当前调用前已观测到 usage 的 assistant message IDs，可与最终 usage 记录对照；遇到多响应/重试等歧义须报告，不按列表序号强配调用 |

`checkpoint.provider_usage.messages` 保存每个已完成 assistant message 的 provider 实测 input（含 cache read/write）与 output（含 reasoning），按 message ID 去重；未能取得用量仍为 unavailable/null。每次调用的测量使用后清空，避免缺 hook 时误用旧样本；缺样本为 null。诊断中不保存原文或原始请求；现有 secret 检查仍先于测量。

本地断言确认分类字节求和、中文 UTF-8 字节、unknown 单列、缺 usage 不冒充 0、跨 session 与 secret 拒绝。真实 OpenCode 配合本地 provider 的测试确认每次调用均有新统计和 system 字节、旧 preview 仍进入后续请求，证明只测量而未裁剪。

**尚未取得 DVGA 的真实构成数据。** 此统计只能支持字节构成与历史增长诊断，不能直接断言有界工作集一定落在 100k token 内；绝对 token 预测和工作集语义充分性须结合真实记录审阅，不能用本地脚本化 provider 的固定 usage 冒充模型证据。

## 本地验证结果

- 实施前基线 `gate:m0`：28 files / 166 tests 通过。
- 实施后 `gate:m0`：28 files / 166 tests 通过；`gate:m1`：3/3 通过。
- 实施阶段全量 `npm test` 曾有 1 项旧入口断言失败；随后该断言在独立提交 `ed3f241` 修正。修正后重跑 `npm test`：49 files / 273 tests 全部通过，包含两个本切片测试文件和 M0/M1 gate。
- `npm run typecheck`、`npm run build`、`git diff --check` 通过。
- 旧断言修正独立于 0.3 代码提交，以保持 0.3 切片提交范围单一；当前全量测试已全绿。

## 待授权与停止位置

B 的代码与本地接线完成；“真实模型不再因手报 cursor 卡住”尚未实测。A 的测量入口完成；真实 DVGA 工作集/历史占比及后续方向判定仍未完成。暂停于此。

本轮没有进行外部模型可用性预检、外部 provider 请求或 DVGA 访问；本地测试只访问既有模拟 provider/测试目标。后续 §0.4 真实 run 的预算提案见当前计划，仍需逐批授权。
