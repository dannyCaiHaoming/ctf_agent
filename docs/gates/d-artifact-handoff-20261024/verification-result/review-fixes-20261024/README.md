# D 第四接口主核对反馈：有界读回／非必要证据失效

同一工作树 `/Users/caihaoming/.codex/worktrees/3e07/pentest-agent`，detached HEAD `639782bed2fd1fe3507c8876c10dcca78a3a8a38`。本轮只修两个直接契约缺口；未合并、commit/push、新开 Codex session、调用真模型或清理 plan/session/worktree。主 session 再核对仍待完成。前一轮证据原样保留，原 manifest 另存 prior-evidence-manifest.json。

## 先复现的真实失败

`RED.log`：15 项测试中 3 failed / 12 passed，三个失败在产品改动之前执行：

1. 真实 Verifier job 产生必要 stdout 与 1 MiB 以上非必要 stderr，旧 read 返回至少 1.3 MiB JSON，超出 native tool_output.max_bytes=262144。
2. 必要 job/preparation 稳定，独立非必要 artifact 损坏后旧 currentAvailability.usable=false。
3. 必要 preparation A 稳定，独立非必要 job 的 preparation B 改变后旧 usable=false。

`entry-source/` 是本轮进入的真实文件快照；`red-source/tests/contract/d-verification-result.test.ts` 是 RED 当时的实际新测试 bytes，`red-test-sha256.txt` 为即时 hash。`red/` 保留未修正回复、原始报告、before/after、必要输入 bytes；与旧轮没有即时新测试快照的情况区分。

## 最终契约

`verification.read({challenge,version,result,cursor?})`：统一有界摘要＋固定报告 JSON 的 base64 页。摘要不嵌入任意 rationale/premises/证据大数据；完整原 judgment、前提、理由、命令/来源/association、完整性和全部证据 bytes 在固定 JSON 中。report 逐页返回 size/sha256/offset/nextCursor/done/pageBytes，raw page 上限 32768 bytes。必须读至 nextCursor=null，串接并核对总长度/hash 才能记完整收到。每页重新核对 currentAvailability，但固定报告 bytes/hash 不随之变动；不是分页过程中冻结外部状态。

失效检查保留登记时不可覆写的 necessary 标记：必要 artifact/preparation 变化阻断；独立非必要 artifact／另一个 preparation 变化只列 warnings（evidenceIndex/reason）。共享必要 preparation 或固定包自身依赖损坏仍阻断，不能靠 nonnecessary 标签绕过。Verifier 选择必要证据及语义充分性仍是未证明边界，不加关键词检测器。

## 同源真实公开 runtime

原始批次位于 `../native-paged-first/`；八案同版源码（runtime-final-source-check.json 全部匹配），每案自己从 E→Solver 真 job/发布→Engineer 固定包→Coordinator 指定版本→Verifier 读/prepare/job/report→原生交回→Coordinator 分页读取；不拼接前轮的通过项。

| 场景 | provider 请求 | 保存报告 | Coordinator 报告页 |
| --- | ---: | ---: | ---: |
| control | 43 | 1 | 1 |
| rejected | 43 | 1 | 1 |
| missing | 43 | 1 | 1 |
| lost | 42 | 1 | 未确认 |
| stop | 45 | 0 | 无 |
| late | 45 | 1 | 未送达 |
| large | 85 | 1 | 43 |
| budget | 39 | 0 | 无 |

probe exit=0；budget 内层 exit=1/budget_exceeded 为预期。Node v26.3.0 / OpenCode 1.19.3 / SDK/plugin 1.19.0；loopback scripted provider，真实模型调用 0，真实 usage unavailable。

large：Verifer job 实际 stdout 9 bytes 必要，stderr 捕获 1048576 bytes 非必要并标记 originalComplete=false。Coordinator 完整接收报告 **1403719 bytes / 43 页**，最大实际 tool 字串 **44294 bytes / 1 line**；每页 raw ≤32768 bytes，均低于实际 262144 bytes / 2000 lines 限额。SHA-256：`0961e957a0b694044fdee481834703e643f128f46b5ea7fea8bb2d3aacceb0de`。原生 provider 真收到的原始 tool 字串重组后与 Coordinator 保存报告、C 匯出登记报告逐 byte 一致；所有 1 MiB stderr bytes 都在，没有静默丢弃或截断。量测见 native-actual-tool-pages.json，原始内容见 large/provider.json、coordinator-read-pages.json、coordinator-report.bin、evidence/verification-results.json、state/jobs/。

实际载入 role 正文/description/工具权限和含 cursor 的 parameters/schema 保存在每案 loadedContext.json；停止仍由 sibling 原生完成通知唤醒 Coordinator，没有 SDK resume child。丢回复/迟到的边界保持前轮陈述：迟到回复实际未送达；unknown、不重试是替身预定选择，未证明模型行为。

## 必要性失效证明层级

R2 由 C contract + 真文件/job 验证，SDK 身份是确定性 fixture，**不冒称 R2 已在 native runtime 另行验证**：

- contract-final/review-independent-artifact：独立 ancillary artifact 损坏后主结果可用，warning 指到该项。
- contract-final/review-independent-preparation：只改 preparation B，A/input.bin bytes 保持 `[0,255,13,10]`，主结果可用并 warning。
- contract-final/review-necessary-artifact：必要 artifact 损坏阻断，原 necessary=true 保留。
- contract-final/review-shared-preparation、review-package-dependency：共享必要 preparation 或包本体依赖损坏仍阻断，即使另有 ancillary 引用。
- contract-final/review-large-metadata：32×8192 中文前提亦完整分頁读回；非法 cursor 拒绝，任意大文本不藏在摘要导致超限。

原 Q2 dishonest echo 和 V3 unknown 证据仍保留：完整但虚假的 echo 论证可通过机械检查，不能称宿主解决语义充分性。分页传输完整也不代表真实模型能在有限 context 中理解全部大报告。外部实例状态、任意未声明依赖、持续完整性／OS 隔离、restart recovery、第五接口／solved 均未补做。

## 最终验证与可复跑命令

commands.json 保存命令、实际退出码与日志。typecheck/build/test 最终均 exit=0；47 files / **390 tests**，定向 9 files / **112 tests**，报告专项 **18 tests**。

```sh
npm run typecheck
npm run build
D_RESULT_EVIDENCE_DIR=docs/gates/d-artifact-handoff-20261024/verification-result/review-fixes-20261024/contract-final D_VERIFIER_EVIDENCE_DIR=docs/gates/d-artifact-handoff-20261024/verification-result/review-fixes-20261024/third-interface-final npm test
# 新鲜 label，不能覆盖已有证据目录；全八案或只 large：
npx tsx tests/manual/d-verification-result.ts NEW_LABEL
npx tsx tests/manual/d-verification-result.ts NEW_LABEL large
```

定向回归命令（targeted.log，exit=0）：

```sh
npx vitest run tests/contract/d-artifact-handoff.test.ts tests/contract/d-h7-rpc-stop.test.ts tests/contract/d-candidate-package.test.ts tests/contract/d-verifier-handoff.test.ts tests/contract/d-verification-result.test.ts tests/contract/control-service.test.ts tests/contract/g-coordinator-stop.test.ts tests/contract/g-team-integration.test.ts tests/contract/opencode-config.test.ts
```

本轮最终源码在 final-source/ 和 final-source-hashes.json，相对进入版本修改见 review-diff.patch；全 Git diff 含前轮未提交改动，见 git-diff.patch。主区只读基线核对见 main-readonly-check.json。本轮 evidence-manifest.json 覆盖本文件夹，父层更新的 manifest 覆盖所有历史与本轮 native 原始证据；不要用前轮 source 哈希代替本轮最终源码。
