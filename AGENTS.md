# AGENTS.md

通用 CTF 解题 Agent。本文件是给在本仓库干活的 coding agent 的工作约定。**开工前读完。**

## 先读哪三份

| 文档 | 作用 |
| --- | --- |
| [`docs/superpowers/specs/2026-10-14-general-ctf-agent-system-design.md`](docs/superpowers/specs/2026-10-14-general-ctf-agent-system-design.md) | **权威设计**，一切以它为准 |
| [`docs/superpowers/plans/2026-10-16-ctf-agent-mvp-roadmap.md`](docs/superpowers/plans/2026-10-16-ctf-agent-mvp-roadmap.md) | 里程碑边界与验收门槛 |
| [`docs/superpowers/plans/2026-10-18-m1-solver-loop-plan.md`](docs/superpowers/plans/2026-10-18-m1-solver-loop-plan.md) | **当前里程碑**的范围、下一步、完成条件 |

索引见 [`docs/superpowers/README.md`](docs/superpowers/README.md)。历史复盘在 `plans/history/`，**那是历史，不是待办**。

---

## 一条不可违反的架构规则

> **复用 OpenCode 的模型、会话、工具调用和 Agent 内循环，不另造通用 Agent framework。** 本项目只增加**薄的产品控制层**（run/challenge/task 绑定、scope、deadline/预算、canonical state、候选与结果）。—— spec line 29

**这条曾被违反过**：M0/M1 的 solve 路径都绕过 OpenCode、直连 provider，并自建了「模型每轮回一个 JSON 动作」的协议。八次校准里约六次死在这套自建仪式上。当前 M1 Task A 正在纠正。

**因此：**
- 不要新增/扩展自建的模型循环、动作协议或 Agent 框架。
- 看到 `ProviderSolverDriver`、`SolverActionSchema`、`solver-loop.ts` 的循环部分——**它们在退役清单上，不要参照、不要扩展**（清单见 M1 plan「代码退役清单」）。
- 需要模型能力时，走 OpenCode；公开 plugin/SDK/server 接口缺 hook 就**返回设计 blocker**，不维护 fork。

---

## 五条从踩坑里来的硬规矩

1. **组件完成 ≠ 集成完成。** schema 写完 + 确定性测试全绿只算组件完成。**凡是必须由模型产出或经模型路径的东西，没有真实模型/真实路径的证据就不许标 COMPLETE。** 本项目最大的事故就是 T8 在 stub provider 上全绿后标了 DONE，而产品路径根本没走 OpenCode。

2. **host 已知的东西不要压给模型。** ID、hash、ref 展开、预算数字、步骤编号——一律 host 注入或推导。发现模型反复在某字段出错时，先问「host 是不是本来就知道这个」；若是，**改契约，不要改 prompt**。

3. **验收判「是否做到」，不判「怎么做到」。** 判据写行为结果（退出码、oracle 认可、canonical 证据链），不要写死具体改法、字节数、patch 次数。曾出现判分器要求「刚好多一个 byte 且必须是指定括号替换」，会拒绝同样正确的修法。

4. **一次一条垂直切片。** 当前轨迹需要什么就补什么，**不要先建通用元件再补接线**。横向建设是本项目反复踩的坑（旧的 391KB 单体计划就是这么死的）。

5. **失败照实记录。** 不隐藏失败 run、不自动重试掩盖、不放宽 scope 蒙混、不把估算当实测。provider usage 拿不到就记 `unavailable`，**不要用 0 冒充**。

---

## 工作方式

- **TDD**：先写失败测试 → 实现到绿 → 自检 → 提交。
- **gate 常绿**：`npm run gate:m0`、`npm run gate:m1` 任何时候都必须全绿。
- **不要长期悬空**：改动做完就提交。本项目出现过 93 个文件未提交两轮的情况。
- **范围纪律**：只做当前里程碑 plan 里的事。plan 标「冻结」的资产（领域解析库、通用验证框架、度量扩展）**保留但不扩充**。
- **真实模型 run 很贵**：发起前确认黄金路径确定性测试通过、网络可达；每次 run 的配置、结果（含失败）、canonical 证据都要落盘到 `docs/gates/`。
- **停止规则**：plan 里设了 attempt 上限，触发后**停下来升级重评**，不要静默重试、重置计数或扩大上限。

## 命令

```bash
npm ci                 # 安装（运行中不装依赖）
npm test               # 全部测试
npm run gate:m0        # M0 确定性门槛
npm run gate:m1        # M1 黄金路径门槛
npm run typecheck
npm run build
```

## 边界

- 运行中的 Agent **不安装依赖**。
- 正式运行不使用公共搜索、GitHub、在线文档或公开 writeup。
- `control_secret`（provider key、平台 Token、VPN 凭证）**永不进入模型、工具 job、artifact 或日志**。
- 未经用户明确授权**不自动 commit**；不自动 push。
