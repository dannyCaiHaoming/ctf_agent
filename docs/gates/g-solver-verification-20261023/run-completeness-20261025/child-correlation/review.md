# 独立只读复核（2026-10-25）

范围：读取主仓AGENTS/CLAUDE、关联plan/design §7.4，以及本审计目录脱敏元数据、probe/observer、候选和baseline；未读transcript/reasoning/凭据，未重跑原生批次，未改产品。首轮review时report.md尚未生成；最终复核已读取report.md与主区详细design新增§9及顶层状态。

## Verdict

计划执行：**有条件通过最小关联可行性范围**。证据质量：**足以将post-bind hook冻结user ID定为最小候选；不足以宣称完整产品机制已实现、所有并发/停止race通过或结果完整性分类器已验证**。

## 已核对的证据

- baseline/tests.log：既有3文件26项通过，属于既有测试，不当作原生race证据。
- probe.ts、notice-read-probe.ts直接调用隔离副本产品launch；baseline plugin index.ts:125/127向ControlService转发chat.message/model.call。baseline control-service.ts:206–237先receiveCompletion，再绑定/返回；post-bind return观察因此不同于入口观察。
- minimal-evidence.json cases single-partial/single-empty与notice-read-partial/empty：同一child恢复一轮，各有两个不同call/ref/user ID，userRole=user，assistant.parentID各自指向冻结user；第一轮length（7或0字符）与第二轮stop（8字符）分离，model.call交叉核对一致。支持“可信绑定后唯一活动execution + hook userID”，不是正文匹配。
- sync-resume第二次capture为unknown:execution-not-unique，未复用前轮ref；仅首轮chain进入冻结表。
- partial/empty两组并发均deadline_exceeded。已观测链未交叉仅是局部观察，不是并发端到端验收通过。failure-early-resume两组也保留deadline。
- source-manifest.json固定binary hash/runtime 1.19.3、baseline/observed hash，并逐batch分配probe/observer hash；v1与增加notice读取的v2分开，失败也关联其版本。HEAD与mainHEADDeclared不同，因此复现基准应同时保留主区声明、dirty输入hash和隔离HEAD，不只写单一HEAD。
- isolation.json记录env allowlist与外连EPERM；probe启动前assert EPERM。该证据支持本地确定性provider隔离，不构成真实模型能力验证。

## 必须保留的条件与限制

1. **notice读取不定位旧execution。** observer-v2只从合成notice抽child ID并读取该child全部messages，不解析ctf ref，也没有将读取结果原子冻结进execution。产品receiveCompletion另按[ctf:ref]定位旧execution并核parent/child（baseline control-service.ts:920起）。因此noticeReads只能证明接收hook期间SDK读取可见事实；关联须继续依靠先冻结ref/userID，不能取child最新消息。v2新增await本身改变时序，不能推断原子可见。
2. **候选是离线原型。** candidate-prototype.py冻结唯一活动execution并保留userID，旧notice-after-resume反例仍归第一轮；它不是产品已有能力。未来冻结应在既有可信串行状态边界执行，不能把return快照复制当作已完成接线。
3. **冲突已封闭且范围有限。** prototype现将同ref不同user标conflict，classify以及后续重复hook维持unknown，覆盖父会话指出的旧映射残留问题。17个反例属于明确替身/离线分类测试，自然重复notice、自然停止race和临时不可见未因此获得runtime证明。
4. **同ID矛盾记录须unknown。** classify当前以dict按id去重，覆盖式合并只检验了完全相同重复；若同id字段相互矛盾，不能允许最后一条覆盖后认定完整。将其列为实际实现条件即可；本轮无需扩大原型为通用分类器或穷举所有finish/error组合。complete/incomplete只作本样例事实分离示例。
5. **不补叫、不扩框架。** 缺消息/冲突/同步无ref保持unknown；结果快照与绑定冻结分离，旧轮unknown不能借下一轮stop补成完整。最小实现范围应限ControlService的execution关联字段、现有hook冻结与按parentID读取；不扩成同步统一框架或并发调度修复。

结论：允许据此定稿有条件的background关联机制及最小实现范围。最终报告若保留上述分层，关联可行性可通过；不得写成全部plan行为场景均已原生验收。


## 最终措辞复核

**最终 verdict：通过上述限定范围的计划合规与证据质量复核，无阻断项。**

report.md已明确区分：同源产品联合原生运行与离线候选；单child完成与并发deadline；notice读取全child元数据与实际ref筛选；包装新增await与非原子可见；冲突修正与有限反例；失败早批脚本重建hash与执行前快照。没有将失败或观察升级为完整验收。其并发收束描述是保存元数据的观察，主区§9进一步保留因果未定，适当。

主区design顶层状态明确“机制定稿、尚未接入、readiness unknown”；§9.1–9.2落实post-bind串行冻结、resume不使用旧dispatchCallID、按ref/user/parentID读取、锁外SDK与返回后重查、同ID矛盾unknown、不补叫、不把下一轮stop补前轮等条件。§9.3将范围限定为后台关联、完整性事实及现有展示，并要求同源原生验收；没有将同步框架或并发调度纳入修复。可用于下一份最小实施plan，不能据本报告宣称产品修复完成。

仅有非阻断文档一致性建议：详细design §3前言仍说“当前选择、已定范围及未决项以§7为准”，而当前后台关联权威已为§9；后续顺手改为§7–§9可避免误读。§9开头已明确取代§7.4，因此不影响本轮结论。
