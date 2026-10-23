# G 配额与默认值：无模型验证

日期：2026-10-23，Asia/Tokyo。工作区：`/Users/caihaoming/.codex/worktrees/5b1d/pentest-agent`。结果为**部分成立，未定稿**；本项调查完成不表示全部配额已实现。

## 结论与判据

| 项目 | 观察与决定 |
| --- | --- |
| workspace 单次 1 MiB | 1048575、1048576 bytes 接受；1048577 拒绝且文件未创建。既有文件覆写 4096→1 byte；失败写入不改变原内容，没有残余 temp。没有统一总量保留或 temp 尖峰额度 |
| 单题 128 MiB | **未实现**。稀疏 seed 实际分配 0 bytes；跨会话受管写入到 134217727、134217728、134217729 均接受；两个并发写入后为 134217731。不是实际填充 128 MiB 的压力测试。边界仅检验候选逻辑口径，不证明物理容量 |
| HTTP／job 对总量影响 | 已有逻辑 134217728 bytes 时，HTTP body 和 job 直接文件写入各新增 1 byte 仍成功，合计 134217730。job stdout/stderr 在 host state/jobs，另有单流 1 MiB cap，但没有共同存储预算 |
| HTTP 并发 8 | 同题跨会话同时九次：8 接受、1 拒绝；另一题另有容量。确认取消后可替补；失败 scope 校验释放。8 次落盘被阻塞且 timeout 后都为 unknown，直到第九次仍拒绝；底层后来返回不自动对账。unknown 保守占槽有效，持久恢复未实现 |
| job 每 session 2／每题 8 | 四个会话并发启动 8 个真实本地进程；第三个同会话和第九个同题拒绝；另一题独立。句柄交付不释放，确认取消和 failed_to_start 结算后可再启动。既有 slow-tools 回归另证 reapIncomplete 保留 session 配额、回收 unknown、撤销及到期 |
| timeout／收尾 | HTTP 0／60001 拒绝，60000 可准入；job 0／600001 拒绝且没有写入标记，600000 可准入并立即取消；真实 50ms job 期限触发 timed_out。before 返回 HTTP 默认/最大 20000/65000、job wait 0/默认/最大 5000/10000/35000（均含 5000 RPC 余量）。既有回归验证绑定到期、HTTP 1000ms 落盘 unknown、C 4000ms 收尾和进程组 unknown。上限准入不等于实际等满 60000/600000ms，也未校准适用性 |
| run 工具计量 | 12 次 workspace.list、0 次 model admission：工具与模型准入分开。audit 有登记／结算，但没有工具累计上限、持久原子保留或恢复入口。以同 options 新建 ControlService 资源和 audit 为空；不是崩溃杀进程的恢复验证。launcher 只在最后保存 audit/resources，不能证明中途故障可恢复 |
| PATH／镜像 | JobManager 默认取 launcher PATH；哨兵 `/gdec-sentinel-path` 被 job 继承。现有 dev 镜像 Env 有固定 PATH，但无默认非 root User，不能证明产品启动始终固定；node/sh/prlimit 可寻址，python3/curl 不在 PATH。F 尚未在本项定稿，不扩建镜像 |

机器判据见 [criteria.json](criteria.json)。评估器退出 **1**：总量、固定 PATH、持久工具计量未满足；数值适用性为未运行。合同测试中的“记录缺口”是现状刻画，测试通过不把缺口变为满足。

## 宿主帐本与 OS 配额的选择

只靠目录扫描或受管工具帐本不能拦截直接 job 写入与并发增长。设计确认需要宿主可信计量配合 OS 硬边界，但具体持久存储方案未选。建议 G 的口径覆盖各会话 work（含 HTTP）和 jobs stdout/stderr；E materials、D published 另有责任者。此范围澄清留给主 session 判断，不视为已获用户批准的契约变更。

宿主应在同题原子保留后才 I/O，覆写按新旧差额结算，同时容纳 rename temp 尖峰；部分写入、取消与 unknown 不能盲目退款。OS 控制实际容量，逻辑大小、物理配置和累计写入量必须分开。

本次原生 ARM64 Docker 小容量实测：固定 dev image、UID/GID 10001、cap-drop ALL、no-new-privileges、read-only 根、network none、无 socket、1 MiB tmpfs。1044480 bytes、1048576 bytes 成功，第一个超出字节 ENOSPC 且原文件仍 1048576；满额 temp 写入失败，缩小后重用成功。两个进程各试写 655360 bytes，最终合计不超过 1048576，至少一个 ENOSPC。注意失败写入可留下部分内容，必须按实际落盘结算。

同一 tmpfs 中 `ftruncate` 到 2097152 逻辑 bytes 仍成功且分配 0：**OS 配置容量不是逻辑大小上限**。重启同一容器时 `initialEntries=[]`，证明 tmpfs 不持久。因此仅保留它为硬容量机制可行性的证据，不采用为产品持久工作区，不推定会话隔离、持久 quota/inode/metadata、crash 恢复或产品默认值成立。本项没有触发 CPU/memory 限制的验证；fixture 的 96m/0.5 CPU 仅是实验约束。

run 级工具计量保留 G §5.6 的候选：可信准入记尝试／接受／拒绝，次数消耗不因业务失败退款；read/list/search、HTTP 实际跳数分开观察，清理和读取既有证据保留入口。wall deadline、并行资源毫秒与 CPU 不混算，unknown 记未结算。未新增数字预算，未调用真实模型/provider/外部靶场，也未运行 OpenCode runtime；不能据此声称模型工具使用或求解能力。

## 验证与复核

在本工作区执行：

```bash
python3 docs/gates/g-solver-verification-20261023/decision-resource-limits/run-checks.py
python3 docs/gates/g-solver-verification-20261023/decision-resource-limits/run-container-probe.py
python3 docs/gates/g-solver-verification-20261023/decision-resource-limits/evaluate-criteria.py
```

前两项预期退出 0，第三项在缺口修复前预期退出 1。容器探针使用随机 `gdec-resource-limits-` 名，finally 只删除自己创建的容器；复核需要该固定 image ID 和 Docker 可用。不挂 secrets/node_modules/.git/out 或 Docker socket。`run-checks.py` 的模型数据客户端是确定性替身，网络仅 loopback。

- 定向：4 文件 50/50（新增 g-resource-limits 16 项＋原有 slow-tools、http-lifecycle、job-tools）。
- 全套：40 文件 307/307；typecheck、build 均退出 0，详见 [命令/退出码](check-commands.json) 与 logs。
- 首次扩大定向/全套各 1 失败：新增等待测试助手把内部 `http.request` 当成 before 插件名。按现有真实入口改成 `ctf_http_request`，原失败点定向 1/1 通过，再跑上述整套通过；保留 `check-commands-first.json`、`logs/*-first.log`、`logs/wait-helper-fix.log`。没有修改产品权限规则来绕过失败。
- npm ci 退出 0；原有依赖报告 10 个审计问题及 pending install scripts 警告，保留日志，未自行升级依赖或批准额外脚本。

原始观察和审计／资源状态集中在 [observations.json](observations.json)；容器操作日志、inspect、命令与退出码分别见 `logs/container-*.log`、`container-inspect.json`、`container-commands.json`。本项无任何真实模型 token 消耗测量，不能把 unavailable 的 usage 写作实测 0。

## 来源与改动归属

HEAD：`d83a0c3024271dbf212db319e900fcf527e68b0f`，当前工作区起始干净、detached。主区 AGENTS/CLAUDE、superpowers 文档及必要历史证据按文件复制；原型源为只读的 `/Users/caihaoming/.codex/worktrees/g-c-rpc-slow-tools/pentest-agent`。按其 git diff/untracked 清单复制 20 个必要产品/测试文件；20/20 同时匹配复制来源 hash 与原批 final-hashes，见 [来源清单](source-manifest.json)、[核对结果](prototype-hash-recheck.json)。不是从主区旧代码重新实现。没有复制 node_modules；本区独立 npm ci。

本项新增内容只有 `tests/contract/g-resource-limits.test.ts`、本证据目录及 G design §3.3/4.4/5.3/5.6/7.1/7.2/9/10 回写；产品实现维持来源原样。其他状态中的改动是来源同步，不是本项新实现。版本见 [versions.json](versions.json)：宿主 Node v26.3.0、Vitest 2.1.8、SDK/plugin 1.19.0；容器 Node v24.22.0／linux arm64。dev image ID 为 `sha256:7e5c5a015288ad55115573b5b25f4bcd668489f1b88b4137ea8563980706672f`。

主 session 待判断：配额范围和逻辑/物理口径；与 OS 隔离/F 兼容的持久硬配额方案；计量恢复的实现与既有 run 约束。全部数值仍为提案，不请求或默增真实 run 成本。未改主区、旧 worktree、宿主网络/代理/VPN/账户；未 commit/push/合并、删除 plan 或归档。worktree 与证据保留待主 session 核对。
