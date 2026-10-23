# G／C／RPC 慢工具与停止接线（2026-10-23）

结果：本轮接通了产品 launcher、产品 entry 插件、真实 C 的题目绑定、文件、HTTP/job、资源登记与停止，并完成无模型验证。**第3节不按整体通过：job超过初始wait_ms之后，仍不能把后续完成结果交回原来的等待task。** 已实际验证公开完成通知/同child恢复候选的具体不足，不把未通过项删除或把局部成功拼接成整体通过。

## 条件与来源

- 唯一修改工作区：`/Users/caihaoming/.codex/worktrees/g-c-rpc-slow-tools/pentest-agent`，detached HEAD `d83a0c3024271dbf212db319e900fcf527e68b0f` 加未提交改动。无commit/push/合并/删除worktree，主区和旧worktree只读。
- 当前适用AGENTS/CLAUDE、G plan、G/C/E/总design、README及既有G证据从主区复制；`sources.json`逐文件记录原路径和hash。未拿HEAD旧G文档作为执行依据。V1按差异应用，保留HEAD最新C停止准入/usage修补；V3/V4/V5必要原型的来源/hash另列其中，`v1-source.patch`保留原补丁。
- 后续用户明确授权覆盖plan的历史“本轮不修改接线”限制，已在本工作区plan顶部与§0A记录。无模型验证与必要关联修复在授权内；不扩展OS隔离、D/oracle或真实模型。
- Node v26.3.0、npm 11.16.0、Vitest 2.1.8、darwin-arm64；OpenCode **1.19.3**，SDK/plugin **1.19.0**。`public-api-hashes.json`绑定实际读取的公开类型。
- provider只启用loopback确定性替身，无真实模型请求/token。运行配置的100000等数字是C准入测试余量，**不构成真实模型预算**；usage零仅是替身回报。运行前完成npm ci，run中不安装依赖。OpenCode保持原有HOME/XDG隔离和禁外部配置/内建额外agent设置。

## 关键实现

1. C只在串行区做存活复核、扣次、宣告/分派/资源登记；SDK与文件/HTTP/job等待在区外。异步返回后再复查停止/撤销/到期。私有work使用设计原路径`workspace/<challenge>/work/<session>`，首次chat.message返回/模型准入前准备，后续hook共用初始化Promise。
2. product manifest注册assign/unassign、workspace list/read/search/write、HTTP、job run/read/cancel，移除已退场工具和D候选入口；product配置按角色可见，C按绑定再次检查。launcher不再只注册Intake。
3. plugin公开ToolContext没有callID。公开before hook在output.args上携带私有Symbol，保存真实hook callID与宿主核准时限；execute单次消费，不加入模型schema/JSON参数。逆序并发同session同tool回归以及产品runtime同轮双写均通过；不依赖非公开context字段。
4. C先登记run/session/call及取消信号，再启动HTTP/job；HTTP每challenge八槽，JobManager每session两/每challenge八槽。job初始wait_ms返回句柄后仍登记到程序组/输出结算。unknown保留配额。
5. plugin等待RPC使用C核准`min(HTTP timeout_ms或job.run wait_ms,绑定剩余)+5000ms`，普通hook15秒；deadline余量不变成工具执行时间。HTTP清理最多1000ms，C资源收尾最多4000ms；job TERM后2000ms KILL，再约1000ms探测、输出关闭等最多500ms。回收未确认则cleanup_unknown。
6. response尚未writableFinished就断开，signal取消原操作。job句柄已产生但响应未finish时仍保留监听，rpc.abandoned关联原session/call/job并取消；正常finish后的running job继续由session/run/deadline拥有。writableFinished不是客户端应用接收回执，finish之后的实际交付未知仍不自动重发。
7. 关联修复：旧JobManager先spawn再开输出文件，stderr打开失败会漏出未登记子进程；改为准备两流后才spawn，失败关闭已开fd。保留原marker失败和修复回归。

## 逐项判据与证据

| 第3节要求 | 实际结果与层级 |
| --- | --- |
| 短暂串行，不阻塞慢I/O | `slow-tools.test.ts`真实C/本地HTTP body屏障，另一题session的准入在释放前完成，revoke可取消；不是HostBoundary替身 |
| 产品plugin+C+launcher+OpenCode合法等待>15秒 | 同次`runtime/accepted` HTTP **16004ms**（timeout20秒）、job **16054ms**（wait20秒/timeout20秒）；状态completed |
| deadline与收尾边界 | fake-clock在真实C请求已登记且连接后触发到期；HTTP旧生命周期20项回归，覆盖DNS到持久化；目录屏障让C在4秒后unknown，释放后不spawn；HTTP落盘阻塞在1000ms后unknown |
| RPC放弃/句柄交付竞态 | 真本地RPC：HTTP未完成断开→cancelled；job已生成handle但响应屏障未释放→rpc.abandoned→cancelled；正常finish→running保留直到revoke；同call不重发 |
| run stop/session revoke/expiry | 真实C撤销会话实测孙进程消失、另一会话孙进程仍活；run stop再清后者。已交付job到期timed_out并拒绝原句柄。登记后目录屏障停止不产生迟到进程 |
| 未知不伪报释放 | HTTP持久化阻塞保留unknown登记；程序组0信号探测注入unknown，作业仍占原session配额，第3个作业拒绝；测试明确是探测结果注入，不称真实OS清理失败 |
| 每题绑定/隔离配额 | 真实C同题两个session共八HTTP槽，第九拒绝、另一题仍可起；作业同session第3/同题第9拒绝，另一题仍可起。历史G-V4 HostBoundary无challengeId，未被当成本项证据 |
| 同一产品入口绑定→文件→HTTP/job→输出→停止 | `runtime/accepted`单次完成：assign/task绑定→materials读→同轮两次work写→HTTP→短job early/late增量输出→16秒job→保留running job→Coordinator完成时统一停止。9个资源全settled，8个completed/exited、最后job cancelled；12条替身请求与12次准入一致 |
| 超过wait_ms仍交回同一等待任务、无需模型轮询 | **未通过。** 现有job.run在wait_ms后返回running，16秒成功仅覆盖wait_ms内完成；实际通知/恢复候选结果见下一节 |

确定性与runtime不混同：RPC断开/交付/expiry/unknown边界使用真实C、RPC、文件/进程与可控屏障，SDK是本地替身；`runtime/accepted`才使用真实OpenCode和产品全入口。未声称每个竞态都有OpenCode runtime证据，未做OS抓包或真实provider验证。

## 公开完成通知/恢复的真实探针

源：`tests/manual/g-c-completion-probe.ts`。仍加载**产品entry插件、launcher、C、OpenCode1.19.3**；测试侧仅wrapper观察真实`JobManager.waitSettled`后调用公开`event.subscribe`/`session.promptAsync`，没有改产品等待契约或增加产品notifier。

`completion-probe/first/resume-and-duplicate`的时序（epoch ms）：

- 1792758106799：job.run的wait_ms=50到达，返回running。
- 1792758106818：原父native task已completed，输出“Waiting for host job completion.”；1792758106833父会话已恢复。
- 1792758107803：真实host job结算exited，reapIncomplete=false。
- 1792758107810：host向绑定的同一child公开promptAsync通知，child恢复为第3条请求；没有反复发起等待轮询。
- 再发相同messageID，仍只有1条通知消息，child请求仍为3；原父task对象/输出前后**完全不变**。

取消对照`completion-probe/first/cancel`：真实job取消后state=cancelled，测试侧通知器抑制通知，无完成后恢复请求。归属来自真实JobBinding，C审计可用job句柄关联原call；events里“bound by C operation”是描述性标记，不是实际callID。实际callID以对应`tool-resources.json`为准。

**结论边界：** 公开接口能恢复同child，该探针能去重和抑制取消通知；但原native task已经返回，直接恢复不会把完成结果交回它。因此“直接完成通知→同child恢复”在当前job.run契约下不足。未穷尽OpenCode其他公开组合，不能泛称接口不支持。更改等待契约或额外父子等待/恢复协议仍是未选定的设计选项，本轮不新增job.wait、不改wait_ms、不自建provider循环。两个探针与`runtime/accepted`分别记录，不拼成同一次通过。

## 检查与失败

| 记录 | 结果/说明 |
| --- | --- |
| `initial-failure.log` | 新增6项先失败：G未接线/callID未关联，RPC原始拒绝路径导致等待超时 |
| `typecheck-first.log` | 新代码/测试类型错误保留；修正record schema与HTTP监听类型 |
| `stop-boundary-failure.log` | 已连接HTTP host deadline误记cancelled；目录等待导致stop和afterEach无界。原样保留，修复后`stop-boundary-fixed.log`10/10 |
| `job-start-failure.log` | stderr打开失败后orphan-marker实际出现；修复后`job-start-cleanup.test.ts`通过 |
| `full-first.log` | 9失败/276通过；旧fixture缺assign/插件before，新manifest下旧“unknown workspace”预期过期。补前置，保留原功能/证据断言，并另测真正unknown工具 |
| `full-second.log` | 1失败/285通过：旧unknown workspace预期，修正为role拒绝加真正unknown工具拒绝 |
| `bind-directory-failure.log` | 目录未在首次准入前按design映射建立；改为绑定后首次hook返回前初始化 |
| `full-accepted.log`和`parent-review-tests.log` | 初始化接入后，旧C/V1 fixture使用不存在材料目录，16失败。改用临时真实目录，不放宽根路径权限；原业务断言不变 |
| `fixture-fixed.log` | slow15+control31 = 46/46 |
| `parent-review-fixed.log` | 主会话独立重跑46/46，初次失败保留 |
| `full-verified.log` | **39文件291/291**通过；含历史HTTP20、workspace9、job9、C31与新增生命周期/启动失败回归 |
| `typecheck-verified.log`、`typecheck-completion.log` | 全类型检查退出0；后者包含新公开完成探针源 |
| `build-accepted.log` | 构建退出0；产品代码此后未变，只改测试fixture/新增手工探针和文档 |
| `runtime/accepted` | 单次完整产品链路通过，源见`tests/manual/g-c-rpc-runtime.ts`；此前`first`/`final`也保留，各自不替代accepted |
| `completion-first.log`与`completion-probe/first/*` | 两个公开恢复探针的观测断言通过；观测结论为原等待任务不能交回，**不是该能力验收通过** |

没有为了绿测降低门槛。旧有效V1/V3/V4/V5结论/失败及旧完整报告缺失状态保留；只有受影响原型移入本区。完整检查日志和最终文件hash保存在本目录。

## 未验证和收口

- 本轮必要判据中未通过：超过wait_ms后自动完成交回原等待task。公开直连恢复候选已有具体不足，其他协议候选未穷尽，需后续在design选择，不在本轮强行补框架。
- G-V6 OS/进程/跨会话隔离、作业网络scope、CPU/内存限制、128MiB工作区配额、run级工具总量、镜像固定PATH仍未验证或未实现；注册job不等于已满足产品运行前提。G-V7真实模型未调用，D/oracle未做。
- response finish后客户端是否实际收到句柄无应用回执；登记保留，不自动重发。服务重启恢复与进程强杀后回收未覆盖。
- 单会话revoke是现有host方法，尚无给Coordinator调用的产品停止工具；不把宿主测试调用描述成该对外工具已存在。
- 主工作区尚未合并本轮代码，文档描述的是此独立工作区。结束不自动开始下一项工作。

复核：

```bash
npx --no-install vitest run tests/contract/slow-tools.test.ts tests/contract/control-service.test.ts tests/contract/job-start-cleanup.test.ts
npm run typecheck
npm run build
npm test
npx --no-install tsx tests/manual/g-c-rpc-runtime.ts fresh-label
npx --no-install tsx tests/manual/g-c-completion-probe.ts fresh-label
```

两个手工probe仅loopback替身，需已安装OpenCode1.19.3；runtime使用约34秒有界实际等待。换新label保留先前证据，不覆盖旧运行。
