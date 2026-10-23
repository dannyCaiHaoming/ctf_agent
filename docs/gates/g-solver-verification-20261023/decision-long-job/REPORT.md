# G 长作业完成交回：候选决策验证

日期：2026-10-23（Asia/Tokyo）。工作区：`/Users/caihaoming/.codex/worktrees/32d7/pentest-agent`。本项仅无模型验证；未 commit、push、合并或删除工作区。没有创建 Docker 资源，未改变宿主网络／账户。原型在本地宿主执行进程组，不证明 OS／网络隔离。

**结论：建议采用同一次工具等待终态，完成交回可行性通过；最终对外契约仍须主 session 复核。** 原型显式增加 `job.run(completion: terminal)`，C 在原初始等待之后等待同一 job.done，RPC 时限跟随作业期限及收尾；未加通知器、job.wait、provider 循环或新的 Solver。缺省入口仍沿用既有 running 句柄语义，不能因此把所有 job.run 都称为已修复。

判据是原等待任务收到终态，无模型轮询，取消／交付边界不破坏资源归属。本项用真实产品 launcher → entry plugin → C → OpenCode 1.19.3 → loopback scripted provider；JobManager wrapper 只观测真实初始返回、输出和终态，**不改变行为或发送完成通知**。

## 候选比较与契约取舍

- **A，同次 execute 等待终态：** 成立，推荐。原型仍验证 `wait_ms`，但它不再触发 running 响应；终态才返回句柄。RPC 核准为 `min(timeout_ms + 4000, binding 剩余时间) + 5000`，执行 deadline 不延长。原型保留显式双模式仅为对照；不建议未经决定就把双模式作为最终产品。
- **B，父子完成／恢复协议：** 既有[直接恢复反例](../g-c-rpc-slow-tools/completion-probe/first/resume-and-duplicate/result.json)已证明原 native task 完成后，promptAsync 恢复 child 不更新其输出。若协议必须保住原 task，child 仍需要一次 pending 工具；若另加父级等待入口，就改变原 task 契约。A 已直接满足目标，因此本项不引入额外通知／恢复编排。B 的其他完整协议没有实现或穷尽，不能写成 OpenCode 整体不支持。`public-api-notes.txt` 仅保存本地 SDK 的相关公开类型检查。

**须主 session 判断：** 是否接受终态等待并放弃提前 running 句柄，以及 `wait_ms` 去留。原模型在 pending execute 中没有句柄，不能声称可同时主动 read/cancel；公开 session.abort 与宿主取消仍有效。若早期句柄／背景返回是硬要求，需要另定协议，本证据不能替代它。

## 证据与结果

| 验证层 | 实际结果 | 文件 |
| --- | --- | --- |
| 原失败点 RED | 五项失败：提前交付 running、取消未返回同 call、timeout 未等待、RPC 已 finish 后断开不再取消、时限仅 5001 而非 609000ms | `01-red.log`（exit 1，预期失败） |
| 定向修正 | 最初五项候选测试通过；补入 unknown 后 slow-tools + job-tools 共 30/30 | `02-green.log`、`05-directed.log`（exit 0） |
| 最终真实入口 success | 同一 run 的 job 初始 wait=20ms；作业约 16 秒。初始返回只到 C，父 task 抓拍为 running；同 child job.run part 最终 completed，父原 task 最终 completed，包含同 job 的 exited/exit=0 和完整 early/late 输出。等待中 child provider 请求为零；全 run 仅 1 次 job.run、1 次终态后 job.read | `runtime/checked/success/`，`provider.json`、`events.json`、`messages-*`、`tool-resources.json` |
| 最终真实入口 timeout | 独立 run：超 20ms 初始 wait，250ms 作业到期；原 task 收到 timed_out，资源结算一次 | `runtime/checked/timeout/` |
| 最终真实入口公开取消 | 独立 run：原 task running 时公开 SDK session.abort 同 child；RPC 放弃取消同 job，原父 task 变为 error，资源 cancelled，取消后没有 child provider 请求；launcher completed 仅表示探针正常收尾 | `runtime/checked/abort/` |
| 确定性边界（6 项） | 待终态期间同会话按宿主已知句柄增量 read，另题会话准入；取消幂等及 call 重复拒绝；timeout／binding expiry；pending RPC 断开取消；609000ms 核准／plugin 接受；进程组探测故障注入保留 cleanup_unknown 与配额 | `tests/contract/slow-tools.test.ts`，`08-suite.log` |
| 既有检查 | typecheck、build 退出 0；全套 39 files、297 tests 全通过 | `06-typecheck-final.log`、`12-typecheck-checked.log`、`07-build.log`、`08-suite.log` |

runtime 各场景独立，不拼成同一次全边界通过；其他会话准入、到期、重复及 unknown 的证据属于确定性边界，不冒称 runtime 都覆盖。旧 promptAsync 反例仍是旧独立运行，不是本次新实现。首次和第二次 runtime 的三项亦通过，保留 `runtime/first/`、`runtime/final/`；新增同 task id/call 与取消 error 断言后的最终运行见 `runtime/checked/`。

已保留的非产品失败：`04-typecheck.log` 退出 2，新增测试直接访问 audit.detail（unknown）导致四个类型错误，按既有测试惯例加窄类型后通过；没有改检查或移除断言。离线产物断言首次误要求 abort 的父 task 也 completed，实际 error 是正确取消语义；见 `10-artifact-assertion-initial.log`。最终探针及离线核对对同一个 task id/call 分别断言 success/timeout=completed、abort=error，没有把取消当作成功。runtime 日志有 Node module.register deprecation 警告，未阻断。

## 来源与复核

文档来自主区当前文件，原型来自指定 `g-c-rpc-slow-tools` 工作区，不使用主区未接线产品代码。`sources.json` 逐文件记录来源/hash/HEAD/status；`prototype-hash-check.json` 核对来源 final-hashes 的 20 个产品／测试文件，零差异。基线 HEAD `d83a0c3024271dbf212db319e900fcf527e68b0f`，包含指定来源的未提交修改。`prototype.patch` **相对于指定原型**，只含本项两个产品文件、一个边界测试和新 manual 探针；相对于 HEAD 的大 diff 含导入基线，不是本项全部新增。

版本和二进制／公开类型 hash 见 `versions.json`。最终产物 hash 见 `final-hashes.json`，命令与退出码见 `commands.json`。本项新增／修改：

- `apps/launcher/src/control-service.ts`：terminal 等待和 RPC 核准；
- `apps/opencode-plugin/src/index.ts`：显式候选参数／说明及有界长 RPC；
- `tests/contract/slow-tools.test.ts`：六项候选边界；
- `tests/manual/g-long-job-decision.ts`：真实入口三个场景；
- G design §5.2、§7.2.1、§9、§10 及本证据目录。

在本工作区复核（命令不会调用真实模型）：

```sh
npx tsx tests/manual/g-long-job-decision.ts review
npx vitest run tests/contract/slow-tools.test.ts tests/contract/job-tools.test.ts
npm run typecheck
npm run build
npm test
```

限制：真实模型工具选择／解题能力未验；609000ms 是核准值与参数边界测试，未持续运行 10 分钟；终态前增量输出是宿主已知句柄读取，未建立提前句柄产品通知；隔离、资源总量、D/E/F 相邻设计不在本项。停止后的宿主输出仍可保存，跨重启恢复未验。没有新增 gate 判据或删除 plan；待主 session 选择性同步文档和证据，工作区保留。
