# Overnight 工作日志（2026-10-29 夜，供早上审查）

状态：**全部在分支 `codex/tooling-analysis`，未 merge main、未 push。** 每个 code 改动都独立验证（Opus 独立跑 `tsc --noEmit` + `test:deterministic`，不只信 codex 自检）后单独 commit。实作由 GPT-6.1-sol（high effort）经 codex 完成；分析由 gpt-6-astra（medium，fast）。行为收益一律**只能由另行授权的真实 run 认账**，本夜未运行任何真实模型／靶场。

## 本夜 commit（分支 `codex/tooling-analysis`，base `60654f0d`）

| commit | 内容 | 性质 | 验证 |
|---|---|---|---|
| `5fb0c104` | 单 Agent 能力缺口分析（7 项排名，研究输入） | docs（astra） | 人工复核 |
| `e87ce12c` | CTF 工具分析（web/misc，联网查 GitHub/writeup，来源分类标注） | docs（astra，联网） | 人工复核 |
| `68a8ef15` | `workspace.search`：命中居中摘录 + 多 needle + offset | code（6.1-sol） | tsc 绿、det 560/560 |
| `dc478cb9` | `workspace.diff`：两份已保存文件的有界字面行级 diff（新只读工具） | code（6.1-sol） | tsc 绿、det 570/570 |
| `08fb65db` | 九角色强化检视（2 提案，7 no-change，均附理由） | docs（astra） | 人工复核 |
| `9ff6003e` | `workspace.search`：有界 coverage 报告（examined/skipped/stoppedEarly） | code（6.1-sol） | tsc 绿、det 574/574 |
| `b75add2e` | `job.run`：终态附有界双流摘录（≤2KiB/流，剥离出验证证据之外） | code（6.1-sol） | tsc 绿、det 587/587 |

## 做了什么、为什么

- **能力/工具分析（两份）**：确认单 Agent 的瓶颈是「每次交互的有效观察 + 线索到实验的成本」，不是缺攻击工具；r8-2 已解出 throwback 且发散未重现。标准 web 扫描/爆破（nmap/dirsearch/Burp）**不引入**（会加重发散、GUI 不合、scope 噪声）。misc/crypto/pwn 工具走「ARM64 镜像预装 + job.run」、按真实接入逐类加；区分可执行工具 vs 禁用的知识库/wordlist。
- **四个 code 强化（全是共享工具、全角色受益）**：
  1. search 命中居中 + 多 needle（修「命中在长行后段看不到」的客观缺陷）。
  2. workspace.diff 有界行级 diff（省「读回两份再逐字比」的往返；观察非判定）。
  3. search coverage（修「空 matches+truncated=false 掩盖被跳过文件」）。
  4. job 终态双流摘录（短错误/短输出省一次 job.read；摘录不入验证证据）。
- **逐角色结论**：Coordinator/Intake/Engineer/Verifier/Recovery-Critic/Reference/Strategy **均 no change**，各附理由（A+D 已是行为基线；Critic 路径未触发但无失败可修；其余无证据缺口）。没有为「每个都改」硬塞 prompt。

## 守住的约束

- 不加爬虫/字典/payload 仓/通用扫描/浏览器/交互终端（无证据需要，或会加重发散）。
- 不新增角色、judge 权、监控调度器、通用框架/知识平台；Critic 仍只建议、Coordinator 决定。
- 不放宽任何既有上限（SEARCH_* / 1MiB / job 配额 / 2KiB preview）、scope、realpath、隔离；所有新回传字段均独立限额，不吃既有预算。
- 所有 prompt 行为（A+D）此前已落地，本夜**未新增 prompt 行为改动**。

## 待验证 / 未做（诚实口径）

- 以上 code 改动只证「装配 + 单元/契约测试绿 + 向后相容」；**是否真减少往返、改善解题，须授权真实 run（例如 r9+）认账，不拿工具次数下降冒充收益。**
- D（有界交回→Critic→换路）在 r8-2 未触发，**仍未验证**；需要一个真会停滞的 run。
- 工具分析里 misc/crypto/pwn 的 ARM64 预装、HTTP 批量对照（#1）、源码→动作定位（#3）、浏览器/TCP/PTY 都**未实作**，按真实接入题型或实测瓶颈再定。
- 两份分析的外部系统引用（PentestGPT/EnIGMA 等）是训练知识 + 本夜部分联网，未逐条核原论文。

## 早上可决策项

1. 这一串（4 code + 3 docs）要不要 merge 进 main？（我未合、未 push。）
2. 要不要 push main（含之前的 r8-2 记录等一串未 push 提交）？
3. 下一步：接入 misc/crypto（如 seizurecipher r9）以真实暴露工具缺口，还是继续 web 侧？
