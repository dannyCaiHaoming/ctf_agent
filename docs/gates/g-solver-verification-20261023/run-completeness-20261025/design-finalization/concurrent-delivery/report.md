# R2 并发通知消费与收束验证

日期：2026-10-25。仅隔离可行性原型，未接入主区、未commit/push、无真实模型或目标。

## 结论

并发残留根因已复现；候选A可解决已观察的正常路径，但**不把本轮结果当整份设计定稿或父展示联合验收**。建议把delivery=consumed严格定义为：本轮可信公开hook提供的上下文含该host已接受notice，且同session/当前user的准入已通过；它是生命周期事实，不是网络ACK、模型理解或事实展示成功。

选择依据：消费需逐个匹配host registry内parent、noticeMessageID及queued状态；既不按SDK全部历史，也不清空全部queued。活跃execution/pending/resource检查完全保留。消费时机仍在admit中，预算/停止检查之后。普通消息、无关ID不能取得一个不存在的notice事实。

## 输入与复现

worktree：`/Users/caihaoming/.codex/worktrees/child-result-validation/pentest-agent`。启动时已有改动为主会话提供基线，见input-hashes.json及baseline/；未覆盖其余文件。相对输入只有control-service.ts、plugin index.ts及两份既有测试，见prototype.patch和source-hashes.json。

固定OpenCode 1.19.3，binary hash及内嵌源片段见binary-hook-boundaries.json。公开SDK plugin类型提供experimental.chat.messages.transform，input为空、output为消息及Part集合。原型只能从消息sessionID取得身份，不能凭全局“最后一次transform”跨父子共享。

原生使用实际launcher/plugin/ControlService、本地确定性OpenAI-compatible provider；env -i、隔离HOME/XDG、sandbox-exec loopback-only，首次外连1.1.1.1:443实测EPERM，见isolation.json/isolation.sb。所有请求为本地脚本响应；usage为替身数据，不是实测模型成本。

原始两角色同description/prompt后台任务，无新增产品fixture。保留ID/notice计数/白名单execution与audit投影，未保存完整provider request。launcher临时产生的完整SDK导出及隔离HOME已在投影后删除；metadata.result.runDir仅为历史位置，不是当前证据链接。

| 样本 | 实际请求 | 父请求notice计数 | 结果 |
| --- | --- | --- | --- |
| baseline（最初观察hook未加载日志环境变量） | 5 | 0,0,2 | deadline_exceeded/1；仅一条consumed，另一queued在停止后suppressed |
| observed（固定日志路径观测） | 5 | 0,0,2 | 同上；transform含两notice而params只携带最后userID |
| candidate-final（逐ID、user配对） | 6 | 0,0,1,2 | completed/0，两notice分别admitNo=5/6 |
| candidate-batched | 5 | 0,0,2 | completed/0，两notice同admitNo=5 |
| candidate-active | 6 | 0,0,1,2 | 第二child响应延迟600ms；第一notice已准入后仍等第二child，completed/0 |
| candidate-batched-final（最终源码hash） | 5 | 0,0,2 | completed/0，两notice同admitNo=5 |

batched样本只在本地provider第二次父响应前延迟150ms，让两notice在父下一轮前就绪；没有更改产品调度。active样本delay使两次通知父请求相隔613ms，超过既有连续idle收束窗口；父未提前退出。active样本早于最终ignored/mixed/empty防护，后者另有离线回归，不能冒充同源全链路验收。

hooks.jsonl保存原始顺序元数据：普通路径先transform、后params、再provider收到请求。minimal-evidence.json索引每次结果和ref/noticeID/admitNo，final-*/metadata.json保留投影。原型日志为观测增加同步文件写入，会影响时序。

## 候选接口及边界

plugin按单session保存一次transform快照，仅保留synthetic且未ignored的notice userID；params必须匹配该快照最后userID，取出后立即删除，再通过现有认证RPC把requestMessageIDs交给model.call。空输入清空、混合session清除相关快照、无匹配不给消费ID。host只消费相同父下已queued且noticeMessageID在集合中的记录，并记录各自真实noticeID；重复已consumed不产生第二次task.delivered。

离线回归覆盖：当前user不匹配、快照一次性、失败后不重用、空/混合输入、ignored Part；错父/不存在ID不消费；重复ID幂等；一项仍active时hasOutstandingWork为true；停止后准入拒绝。既有重复notice、迟到、停止、预算、SDK读取失败/冲突测试同时回归。此为可控分支测试，不声称自然停止竞态或传输故障。

定向测试：2文件52项通过（directed-final.log）；typecheck/build通过（*-final.log）。未跑全仓测试；原型不是产品交付，不宣称全仓验收。测试中新增了ID集合契约；正式实现仍需按最终选定契约验收。

## 裁剪、compaction和未知

固定binary内嵌源核对显示：普通路径transform后仍调用toModelMessagesEffect，再进入process/chat.params/provider适配；因此公开hook不是最终wire消息集合，无法把其ID集合命名为“网络已送达”。同版本compaction另一路也调用同名transform，使用head子集，随后转换为摘要prompt。仅根据hook名推断完整实际输入是错误的。

当前原型在新transform覆盖旧快照、当前user匹配和一次性删除上采取保守防护；离线测试证明这些分支，不证明所有自然compaction交错。compaction agent不是产品角色；现有control绑定/agent检查会拒绝其params，且准入前不消费。普通后续transform会替换快照。**未实际触发compaction，也未实测其他adapter/ignored后置变换/插件链覆盖。**

本轮可定的是生命周期“获准上下文输入”语义及逐ref匹配方向；它足以解释并修复queued残留，不需要网络ACK或新调度。它不能保证host展示文字最终未被适配裁剪。若未来要求consumed必须代表provider实际可见，当前公开hook证据不够，必须保留此blocker，不能偷偷用新语义降低父展示验收标准。

## R4联合验证要求

1. 在同一最终源码集合叠加已选父展示原型和R2候选，实际父provider请求同时含两条notice及各自唯一host事实，并与ref/角色/完整性导出一致；queued释放使用同一批admitNo，正常收束。
2. 保留一child仍active的场景，确认先显示已结束事实且不提前结束；同步R3若纳入，不能误认旧后台ref。
3. 明确compaction范围：至少实际触发一次临界上下文场景，核对snapshot拒绝/替换、是否有未投递事实被摘要或裁剪。若公开hook不能提供wire保证，则设计分别陈述获准输入生命周期及已测adapter的实际可见性，不宣称普适保证。
4. 重复/停止已有分支证据可复用，但联合改动若改变拒绝路径需定向回归。不要求真实模型理解，不新增通用ack、上下文管理或补叫循环。

候选保留在隔离worktree供独立review。原型未合入、未更改主区文档；是否可把未覆盖compaction列为限制或仍为必要blocker，应由主会话结合整体目标决定，不以本报告自行排除。
