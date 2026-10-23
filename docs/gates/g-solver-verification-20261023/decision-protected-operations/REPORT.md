# G 受保护操作：职责与无模型验证

日期：2026-10-23（Asia/Tokyo）。工作区：`/Users/caihaoming/.codex/worktrees/1b6f/pentest-agent`。

结论：**不新增 G 端点语义分类器；采用可信 adapter 描述、宿主意图与 unknown 管理的责任方向。完整产品接线仍未定稿。** 本次只有测试侧宿主原型、本地 loopback HTTP 与真实 SQLite 持久化，没有真实模型、provider、平台、外部靶场或 OpenCode runtime 调用；未使用 Docker。

## 判据与候选取舍

比较了可信 D/E adapter 描述、G 依据方法／端点／模型自述分类，以及未知端点统一人工审批。实际 GET 启动计时、POST 只读观察的反例排除了第二种作为可信来源；第三种不能补足语义且会扩大审批。第一种的局部可行性得到支持，仍依赖 D/E 提供真实来源与对账契约。

宿主须在发送前保存意图；传输与业务结果分开；发出后无权威结果时 unknown 不自动重发；隔离同一副作用范围（含别名），其他观察与无关操作可继续。fixture 封闭清单只用于使该判据可检验，不是通用分类能力或已批准的新产品契约。

## 实际证据

定向最终 **11/11**，全套 **40 文件、302/302**，typecheck/build 退出码均为 0。完整命令与每次退出码见 `commands.json`，日志保留在同目录；各次独立运行，不拼接为同一次验收。

| 覆盖 | 实际观察 |
| --- | --- |
| GET 计时、POST 观察 | 原 G 传输均会发送；模型附带 `effect: safe` 不能改变实际副作用 |
| 意图先存 | 服务器收到受保护请求时，用另一个 SQLite 连接已经能读到 dispatching、来源 hash 及实际操作引用 |
| 限次、别名与并发 | 共享副作用 scope 的两个并发操作只发送一次；业务拒绝也消耗发送限次，不因 HTTP 200 返还 |
| 发出后断线 | 目标计数已增加，宿主记录 unknown；重建宿主并重新打开 SQLite 后，同操作及别名仍拒绝，POST 观察和独立计时操作继续 |
| 200 无业务回执 | transport=response、httpStatus=200，但 business=unknown，状态不确认且别名不可重发 |
| 通用入口绕过 | 直接受保护路径、模型安全声明、未描述 query、替代 Host、方法变化、未知路径、重定向到计时路径均不能产生受保护发送；正常 POST 观察可用 |
| 来源与落盘失败 | 来源文件 hash 变化拒绝装入；SQLite 已关闭导致意图无法保存时，目标零连接 |
| 崩溃遗留 | dispatching 记录保守阻止同副作用范围重发；普通观察仍可用 |
| E 现行准备 | 真实 prepareRun 会建立一次 TCP 连接，即使未发 HTTP；不能证明对“连接即计时”来源无副作用 |
| 旧平台服务 | 旧 PlatformService 在 unknown 后换 generation=2 会再次实际发送；本地断线 fixture 收到两次请求。它不是已经满足新 D 契约的实现 |

原始请求次序、计数、部分持久记录及结果在 `fixture-trace.json`；仅含人为构造的 fixture 数据。测试与原型源快照位于 `prototype/tests/`，没有秘密或题目答案。

## 失败与限制

- 首次红灯含测试 fixture 输入／输出同名导致的 EEXIST；改名后剩下的 7 项均因宿主原型未实现而失败，见两份 red 日志。实现后 9/9 通过。
- 后续将“收到 HTTP 200，但业务 unknown”判据加强后，原型误写为 transport unknown，出现 1 项红灯；修正为 transport=response 后定向与全套通过，失败日志未覆盖。
- 原型在 `tests/support/`，没有注册新工具、没有修改角色权限、没有接产品 C/RPC。来源 hash 是宿主预先选定来源的完整性绑定，本身不证明任意输入可信；fixture 来源是测试安排，真实来源仍待 D/E。
- 只对该 fixture 的有限操作清单成立。它拒绝未描述 query/body/header，是验证范围限制，不能直接套用到所有 CTF HTTP 流量。参数、路径别名、虚拟 Host、共享 cookie／实例等实际资源范围需可信 adapter 定义。
- 只有单宿主同步准入与本地 SQLite 重开，没有验证多宿主竞争、断电级耐久性或真实平台一致性；原型预算和 generation 都是 fixture 值，不能作为产品预算实现。
- 尚无权威对账／自动解锁接口；unknown 保留不解除。没有验证脚本、直接 TCP、UDP、浏览器等完整出口保护，也未解决相邻 OS／网络隔离问题。
- 不宣称 solved、自主解题能力、G 整体完成或真实平台保护已实现。模型 usage 为 unavailable；没有将缺失 usage 写成 0 token。

## 来源与变更归属

基线 commit `d83a0c3024271dbf212db319e900fcf527e68b0f`。当前 AGENTS/CLAUDE 与 design 来自主工作区；程序基线按要求来自只读的 `g-c-rpc-slow-tools/pentest-agent`。`sources.json` 保存复制来源与逐文件 sha256；其上游 final-hashes 中的 **20 个产品／测试文件全部匹配**，原清单另存 `upstream-final-hashes.json`。本工作区全部导入程序／既有测试的 bytes 保持不变，详见 `baseline-preservation.json`。

本任务实际新增 `tests/contract/g-protected-operations.test.ts`、`tests/support/g-protected-host.ts` 和本证据目录；修改 G §4.5／§9／§10，以及 E §6 的连接计时待定项。`design.patch` 只含本任务相对导入文档的改动。其余相对 HEAD 的程序差异属于导入原型，不能归为本次新实现。

Node v26.3.0、npm 11.16.0、Vitest 2.1.8、SDK/plugin 1.19.0；具体环境在 `versions.json`。临时服务仅监听 127.0.0.1；测试清理自己创建的临时目录和连接。未 commit/push/合并，没有修改主区或旧工作区，没有删除 plan 或归档本会话。

## 复核与待主 session 判断

在本工作区执行：

```sh
G_PROTECTED_EVIDENCE=docs/gates/g-solver-verification-20261023/decision-protected-operations npm test -- tests/contract/g-protected-operations.test.ts
npm run typecheck
npm run build
npm test
```

主 session 可选择性同步 G/E 文档差异和本证据目录；原型源保留在工作区及证据快照，不需要合并产品代码。需核定 D/E 可信描述覆盖的操作域、未描述请求的处理、共享平台／实例资源的 scope、对账及解锁方式，以及 E 对连接即计时来源的接入策略。上述外部契约没有在本任务默认为已批准，G §10 继续保留完整接线未定项。
