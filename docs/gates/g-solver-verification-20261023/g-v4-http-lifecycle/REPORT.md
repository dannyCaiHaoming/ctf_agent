# G-V4 HTTP scope、全程 deadline 与取消补验

日期：2026-10-23（Asia/Tokyo）。本轮已完成 **HTTP 适配器局部原型验证**，不代表 G 产品接线或真实解题能力通过。

## 范围、来源与版本

- 独立 managed worktree：`/Users/caihaoming/.codex/worktrees/g-v4-http-lifecycle/pentest-agent`；detached HEAD `d83a0c3024271dbf212db319e900fcf527e68b0f`，未提交。用户授权 gpt-6.1-sol 仅执行 G-V4 必要原型、测试、无模型验证和文档回写。没有启动 G-V5/G-V6/G-V7 或 plan §3 产品接线。
- 当前适用 AGENTS、design、plan 从主工作区 `/Users/caihaoming/Documents/pentest-agent` 按原路径复制，未使用 HEAD 中的过时文档；[sources.json](sources.json) 记录全部来源、目的与 sha256。除 G design／plan／README／总设计的本轮状态更新外，其余复制文本保持原样；G-V1/G-V3 结论与必要旧证据保留。
- 原型基线来自只读旧工作区 `/Users/caihaoming/Documents/pentest-agent/.claude/worktrees/g-v4-http-tools-555451`，旧 HEAD `9fb3e01d1c72a25faf597e9546b0c9c032617af1`。旧 `http-tools.ts`、测试原件完整保存在 [historical](historical/)，hash 见 sources。旧工作区搜索只找到原型、测试及另一 runtime-http-session 测试，**旧 G-V4 完整报告／日志未找到**；旧九项与变异检查的历史声明保留在 design，不补造其旧日志。本轮九项重新执行。
- Node v26.3.0、npm 11.16.0；SDK/plugin 1.19.0、TypeScript 5.6.3、Vitest 2.1.8、@types/node 24.0.0、tsx 4.19.2、zod 3.23.8，使用 `npm ci` 锁定安装，无声明／安装版本差异。实际平台、OpenSSL 与 lock hash 见 [versions.json](versions.json)。安装输出保存在 [install.log](install.log)：原锁定依赖报告 10 个漏洞及安装脚本提示，未擅自升级依赖。
- OpenCode runtime 未在此切片启动；项目解题 provider 请求 0，solver 模型 token 消耗 0。仅本地无秘密 HTTP/HTTPS/TCP fixture；未使用远端目标。

## 原始失败与修正记录

| 证据 | 实际结果与处理 |
| --- | --- |
| [01-original-dns-failure.log](01-original-dns-failure.log) | 旧九项 9/9 通过；新增 DNS timeout 回归失败：20ms 到期尚未结算，释放 DNS 后 `allowed`、授权连接 1、越界连接 0。原始失败被直接复现 |
| [02-dns-fix.log](02-dns-fix.log) | 最小可取消 DNS 等待与返回后复查修正后 10/10 通过 |
| [03-lifecycle-red.log](03-lifecycle-red.log) | 新生命周期 7 失败／1 通过：旧原型忽略宿主取消与 deadline；取消后仍连接、重定向继续 6 次、名额未释放；其中地址测试另因 macOS 未配置 127.0.0.2 出现 EADDRNOTAVAIL 和测试超时，明确属于 fixture 问题 |
| [04-address-fixture-correction.log](04-address-fixture-correction.log) | B 改为系统可监听的 ::1，同端口双服务；单独地址固定测试 1/1 通过，无需改变旧 pin 实现，没有虚构第二次 DNS 解析 |
| [05-lifecycle-first-fix-failure.log](05-lifecycle-first-fix-failure.log) | 加入宿主 operation、信号及全程 deadline 后 17/18 通过；重定向测试误以为一个 setImmediate 就关闭 socket，实际取消正确、第二跳未发，但 close 尚未结算。改为先等真实 pending 结束、再释放 DNS；未删除关闭／名额判据 |
| [06-directed-final.log](06-directed-final.log)、[07-typecheck.log](07-typecheck.log)、[08-build.log](08-build.log)、[09-suite.log](09-suite.log) | 首次定向18/18、typecheck/build、全套241/241通过；这是评审前中间结果，不冒充最终版本 |
| 独立只读评审 | 1 Important：直接等待 mkdir/writeFile 可能无限拖延取消／deadline；无 Critical、无 deferred minors。评审没有独立重跑测试。按该问题做一次修复，不扩展产品接线 |
| [10-persistence-red.log](10-persistence-red.log) | 可控文件写入屏障的 cancel／timeout 两项均先失败：释放前不结算，释放后仍写 `1.bin`，普通失败释放名额，不能声称全程有界 |
| [11-directed-final.log](11-directed-final.log) | 文件写入 AbortSignal、停止竞争与1000ms收尾上限修订后，最终20/20通过；阻塞收尾返回 `cleanup_unknown`，宿主替身保留登记/名额，迟到屏障释放后未写文件 |

## 最终判据与观察

最终代码：`apps/launcher/src/http-tools.ts`；保留旧测试 `tests/contract/http-tools.test.ts`，新增 `tests/contract/http-lifecycle.test.ts`。文件 hash 见 [final-hashes.json](final-hashes.json)。

| 判据 | 本轮观察 |
| --- | --- |
| 旧九项全部回归 | origin scheme/host/port、逐跳越界停止、IP无DNS、cookie origin/path与题目隔离、header拒绝/Host允许、1MiB输出上限、忽略代理、自签TLS授权origin例外均通过；openssl在场，TLS未跳过 |
| DNS timeout／cancel | Promise 屏障期间结算，释放 DNS 后授权及越界服务均 0 连接；宿主 deadline 比 timeout_ms 更早时也生效 |
| 固定实际 socket 地址 | 同端口A=127.0.0.1、B=::1；解析返回A后答案变B，服务端socket localAddress为127.0.0.1，A连接1、B连接0、resolver调用1；未造第二次解析或宣称覆盖不可达不一致分支 |
| 连接取消 | 真实 TCP 接收 HTTPS ClientHello 但不返回TLS握手；宿主取消后请求返回cancelled、服务端socket关闭、登记名额释放。这覆盖连接/TLS等待，不声称模拟了OS SYN黑洞 |
| 重定向取消 | 第一跳完成后，第二次DNS卡住；取消结算、关闭旧请求后释放DNS，服务端仅1次请求、无第二跳连接 |
| body取消 | 服务端写部分body但不end；取消销毁真实socket，保存一次终态后释放名额 |
| 单一deadline | 可控假时钟配真实本地HTTP；第70ms允许重定向，第100ms body等待超时，第二跳不重置100ms计时 |
| session/run隔离与替身登记表8名额 | 测试宿主替身先登记后启动、先停止标记后abort。r1/s1停后剩2项；r1停后仅r2剩1项；释放DNS仅r2连接成功。8项各记录一次终态、已知回收时释放并可重用；已停会话不再登记 |
| 落盘阻塞取消／deadline | 同一HTTP deadline覆盖持久化等待；停止触发内部AbortSignal。收尾最多1000ms，卡住返回cleanup_unknown，未知登记/名额保留；迟到写入屏障释放后无1.bin。已经开始的真实写入仍可能留下部分文件，不报告成功body |

## 最终检查

- `npx vitest run tests/contract/http-tools.test.ts tests/contract/http-lifecycle.test.ts`：20/20通过，[11-directed-final.log](11-directed-final.log)。
- `npm run typecheck`：通过，[12-typecheck-final.log](12-typecheck-final.log)。
- `npm run build`：通过，[13-build-final.log](13-build-final.log)。
- `npm test`：35 files、243/243通过，[14-suite-final.log](14-suite-final.log)。这是包含评审修复后的完整版本，未拼接不同版本的局部成功。
- [source-recheck.json](source-recheck.json) 复核全部复制来源 hash；主工作区与旧工作区来源文件均未变化。没有向其写入；原型和本轮文档只留当前独立工作区。

## 局部接口、判断与限制

- 宿主固定 `target/jar/workDir`；已完成可信核实与资源登记后调用 `request(args, {run, sessionID, callID, signal, deadline})`。deadline为绝对Unix毫秒，取宿主deadline与工具timeout最小值；身份不读模型args。局部选择已回写G design §4.2.1，不只留plan。
- `HostBoundary`仅在测试内，是明确的C边界替身；其停止标记、资源登记、替身登记表8名额、终态保存、未知名额保留不能当作真实C服务实现。fixture 以整张 active 登记表计数，没有 challengeId，未验证每题配额分组或跨题独立配额。真实C／产品插件／launcher／RPC队列、慢工具时限、RPC放弃、自动绑定到期与实际run停止接线仍未验证，plan §3仍待独立切片。
- DNS底层resolver不能被AbortSignal取消；本轮证明取消等待和阻止迟到连接，不声称终止系统DNS操作。销毁请求后等close；落盘使用AbortSignal，收尾最多1000ms，超限明确unknown并保留名额。这1秒不延长HTTP执行。真实宿主后续unknown核对未在此实现；错误判断可能导致保守占用配额，需要后续宿主对账。
- macOS地址fixture用::1替换不可用127.0.0.2，不调整授权origin或放松scope；异步close以真实结算为依据，不能用一次事件循环猜测。旧有效结论和所有本轮失败保留。
- 未改动真实C控制服务、插件/RPC、job、网络/OS隔离；没有真实模型调用、commit/push、合并或删除工作区。G-V1/G-V3不重跑、不改写其验收结论。完成后停止。
