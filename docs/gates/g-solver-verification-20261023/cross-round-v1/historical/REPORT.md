# G-V1 报告：challenge.assign 绑定宣告时序（无模型）

执行日期 2026-10-23。token 预算 0：探针只用 loopback 确定性替身 provider，不调用任何真实模型，不读取 `.env` 或真实 key。

## 1. 环境

| 项 | 值 |
| --- | --- |
| worktree | `/Users/caihaoming/Documents/pentest-agent/.claude/worktrees/e-intake-tools-0168da` |
| 分支 / 基线 HEAD | `claude/g-v1-binding-probe-b9c211` / `9fb3e01d1c72a25faf597e9546b0c9c032617af1`（改动未提交） |
| OpenCode | `1.19.3`（`~/.opencode/bin/opencode`，`startManagedOpenCode` 校验通过） |
| node | v26.3.0 |
| 执行模型 | Haiku 5.5（plan 第 0 节指定 Sonnet 5.5；此为偏离，如实记录） |
| 探针位置 | `scratch/g-probe/`（未提交）：`harness.ts`、`stub-provider.ts`、`probe-plugin.ts` |
| 运行目录 | `os.tmpdir()/g-probe-<场景>-XXXXXX`，仓库外，未删除 |

注：`docs/superpowers/` 的 G design 与 plan 只存在于主 checkout 的未跟踪文件中；本 worktree 无此文件，本步按主 checkout 的文本执行。`scratch/c-probe/` 不在本 checkout 中，探针为重新编写，沿用 C 报告的方法。

## 2. 候选做法

- **候选 A（首轮，已否决）**：宣告效果在 `challenge.assign` 的 `tool.execute` 生效。
- **候选 B（现行，本报告的通过依据）**：宣告效果在 `challenge.assign` 的 `tool.before` 生效；`tool.execute` 只核对角色，不改状态。

候选 A 的失败原因：同一模型轮的并行工具调用中，两个 `tool.before` 先于第一个 `tool.execute` 执行，`task` 的 `tool.before` 看不到宣告（见 3.1）。

## 3. 真实 OpenCode 探针（T1、T4、T5、T7）

判据见 `evidence/*/control-audit.json`（`seq` 为控制服务的全局序号）。

### 3.1 候选 A（宣告在 `tool.execute`）：失败

证据：`evidence/candidate-execute/`。

| 场景 | 结果 | 直接观察 |
| --- | --- | --- |
| T1 | 失败 | `T1-1`：seq 4 `assign` 的 `tool.before` 放行，seq 5 `task` 的 `tool.before` 被拒（`no challenge declared for role`），seq 6 才是 `assign` 的 `tool.execute`。无子会话。 |
| T4 | 通过 | `T4-1`：seq 8 `assign.release`（父会话下一次准入时释放），seq 10 下一轮的 `task` 被拒，无子会话。 |
| T5 | 未验证 | 第一轮分派已被竞争拒绝，无子会话，恢复冲突未执行。 |
| T7 | 失败 | 同 T1。 |

### 3.2 候选 B（宣告在 `tool.before`）：通过

证据：`evidence/candidate-tool-before/`（T1 三次、T4 一次、T5 一次，共五次真实 OpenCode 运行）。

| 场景 | 结果 | 直接观察 |
| --- | --- | --- |
| T1 | 通过（3/3） | `T1-tb-{1,2,3}`：seq 4 `assign` 宣告 X，seq 5 `assign` 的 `tool.before` 放行，seq 6 `task` 的 `tool.before` 放行（宣告已在前），seq 8 子会话 `bind` 为 `challengeId: X`，其首个 hook 为 `chat.message`（`first-hooks.json`），其首次准入 `model.call` 在 seq 11，晚于绑定；seq 12 `task.correlate` 指向该子会话。 |
| T4 | 通过 | `T4-tb-1`：seq 8 `assign.release`，seq 10 下一轮 `task` 被拒（`no challenge declared for role`），无子会话。 |
| T5 | 通过 | `T5-tb-1`：第一轮子会话绑定 X。第二轮宣告 Y（seq 15）与恢复该子会话同轮（seq 16），恢复被拒（`declared challenge differs from the resumed session`）；seq 20 释放 Y；第三轮无宣告恢复放行（seq 22），子会话 seq 23 再次收到 `chat.message` 并准入。 |
| T7 | 通过（3/3） | 与 T1 相同：子会话首个 hook 为 `chat.message`，绑定（seq 8）早于其首次准入（seq 11）；首次模型请求在准入之后。 |

**限制：** 同轮两个工具的 `tool.before` 之间的先后，依赖 OpenCode 按模型流中的顺序发起各工具的 hook。本次 4 次同轮运行（T1 三次、T5 一次）均观察到相同顺序，但没有接口文档保证此顺序。

## 4. 单元测试（T1–T6）

`npx vitest run`：207/207 通过；`npm run typecheck` 退出码 0。`tests/contract/control-service.test.ts` 中 T1–T6 全部通过：

| 项 | 结果 |
| --- | --- |
| T1 宣告后分派绑定，绑定早于首次准入 | 通过 |
| T2 无宣告的解题角色分派被拒，不产生子会话 | 通过 |
| T3 同角色未消费时重复宣告被拒 | 通过 |
| T4 宣告在父会话下一次准入时释放 | 通过 |
| T5 恢复时宣告不同题目被拒；无宣告照常恢复 | 通过 |
| T6 run 范围角色与非 coordinator 不可宣告 | 通过 |

既有测试的改动：`control-service.test.ts` 的 `declare` 辅助函数改为先经 `tool.before` 宣告、再经 `tool.execute` 核对；`intake-tools.test.ts` 的 `bind` 对解题角色先经 `tool.before` 宣告。断言未放宽。

## 5. 结论

- **G-V1 通过（候选 B）**：T1–T6 单元测试通过；T1、T4、T5 与 T7 在真实 OpenCode 1.19.3 中有证据（T5 需候选 B）。
- **候选 A 不成立**：宣告效果不能放在 `tool.execute`。
- G design §2.1 需改写：宣告效果在 `tool.before` 生效；同轮 `assign` 与 `task` 的先后由 hook 发起顺序决定，且「父会话下一次准入释放」仍成立。这些结论由主 session 回写。

## 6. 证据

- 最小原始证据：`docs/gates/g-solver-verification-20261023/evidence/`（每场景的 `control-audit.json`、`first-hooks.json`、`stub-log.json`、`outcome.json`）。
- 完整证据（含 SDK 会话与消息）：`scratch/g-probe/evidence/`（未提交）。

## 7. 未验证部分

- 同轮 hook 发起顺序没有接口保证；本次未覆盖 `assign` 与 `task` 顺序相反的情形（这种情形下应被拒绝，但未在真实 OpenCode 中验证）。
- 产品插件 `apps/opencode-plugin` 目前没有注册 `ctf_challenge_assign`；探针插件是 scratch 版本，产品接线未做。
- 未覆盖 `skill` 的 hook；未做真实模型调用；未做 OS 层抓包，「无外部连线」仍只靠 loopback 替身与代理环境变量推断。
