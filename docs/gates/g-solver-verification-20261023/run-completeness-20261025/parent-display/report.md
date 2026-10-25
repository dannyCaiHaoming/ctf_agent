# 候选 A 无模型验证

结论：候选 A 在 OpenCode 1.19.3 正常单 child 两轮，以及一个实际原生 unknown 样本中成立：同条 chat.message 新增 host 事实到达对应父 provider 请求，且与持久化消息及 execution 同源事实一致。仅验证可见性，不证明模型理解、Critic 调用、正确或 solved；未接入主区。

## 最小原型

仅修改隔离副本 apps/launcher/src/control-service.ts、apps/opencode-plugin/src/index.ts，既有 tests/contract/g-async-lifecycle.test.ts 添加 4 个负例。prototype.patch 相对审计 baseline；source-hashes.json 为最终来源；before-fix.patch/before-fix-plugin.ts 保存失败版本。

host receiveCompletion 返回本次接受 ref 列表；最终 admission serial 对本次 ref 核对 parent、noticeMessageID、queued、child active/有效期。普通消息不能凭 messageID 查出历史事实。返回白名单 ref/role/completeness/reason/finish/textChars/source。unknown 的 textChars=null，表示不可据默认0证明空结果。字段均来自 host execution，不解析 child 文本。plugin 在同条 output.parts 新增完整 synthetic text Part，程序生成 id 并绑定 sessionID/messageID，保留原 notice 不变。无新工具、额外 prompt、调度或 result-ref。

展示字面文本为 `[CTF host result facts] {白名单JSON}`，下一行 `Execution ended does not imply a complete report; complete does not imply correct or solved.`。ref 标识该 execution；role 是受信角色；completeness 仅报告完整性；reason 是分类原因；finish 是原生终止原因或null；textChars 是可判定的报告文字长度或null；source 是关联状态。执行结束不保证完整，完整不保证正确/solved。

## 实际原生证据

native-probe-final.ts 使用实际产品 launcher/plugin/control；固定 1.19.3，env -i、独立 HOME/XDG、OS loopback-only。isolation.json 证明外连 EPERM，只有虚构 OFFLINE_STUB_KEY，无真实模型或目标。provider 收到完整请求后只保存相关 host 文本及 notice 计数和身份/顺序投影，不保存完整请求 body/prompt/reasoning。launcher 原有消息证据用于局部字段对照。

verified-projections.json 由 verify-projections.py 独立断言实际 provider 投影、持久化父 Part 身份、execution resultFacts，并检查原 notice 等于 execution 原包络。partial/empty 各7请求、2 child调用；前三请求无事实，首 notice 后父请求含1条，第二轮后含2条不同ref。partial 首轮 incomplete/length/textChars7；empty 首轮 incomplete/length/textChars0；次轮均 complete/stop/textChars8。旧事实在历史再次携带不算新注入；同父消息恰好1个事实 Part，原包络未改。

原生 unknown 样本原想发送 unknown finish，但 OpenCode 自身继续了一次 child 请求；实际为8请求、3 child调用、2 execution。首 execution 因 multiple_assistants 判 unknown（不是 unknown_finish），父请求如实展示 unknown/reason multiple_assistants/finish null/textChars null；第二 execution complete。此差异保留，不改样例冒充 unknown_finish。

初次原型不含完整 Part id/sessionID/messageID：原生保存拒绝 invalid user part before save，父请求没有新增、两组 deadline，相关 single-*、native.log、before-fix* 保留。修正完整 typed Part 后正常，无 cast 掩盖。审计目录首次启动因无 type=module 在运行前失败；该启动错误输出在工具记录中，native.log 已用于其后失败运行。before-fix 产品源码由最终版本准确去掉 Part 身份字段重建，非当时即时快照；对应运行日志可核对缺字段错误。

## 离线负例与检查

定向 opencode/g-async-lifecycle/g-coordinator-stop 59测试通过（在首版原型执行，并非 clean baseline）。增加测试后 g-async-lifecycle 45测试通过；最终 typed Part 修正后 typecheck/build 通过。SDK缺data、SDK抛错、source_conflict 测试明确 unknown/null；非synthetic伪造、普通消息同ID无展示；重复/旧通知拒绝；既有错parent/child、SDK等待期间stop/revoke、重复并发负例通过。SDK缺失/错误/source_conflict 是替身分支证据，不是原生传输故障；未声称HTTP故障验证。无需模型成本授权，真实usage不适用；脚本usage固定演示值。

## 限制与收口

没有测试自然竞争时序、并发多通知收束、同步恢复、模型理解或Critic；未扩Root/readiness/Skill。末次serial后plugin保存仍存在既有分布式时间窗口，本片未新增原子调度保证。原型保留待主会话复核，未commit/push、未改主区。无observer/monkey patch/额外SDK轮询，投影只发生在本地provider请求处理阶段。自有运行进程已正常退出，worktree与审计保留。


## 父复核后补齐检查（产品源码冻结）

在审计 baseline 副本复用同一 node_modules 执行既有 opencode/g-async-lifecycle/g-coordinator-stop：3文件59测试通过，exit 0，见 baseline-directed.log/.exit。最终完整 typed Part 原型执行同三文件：3文件63测试通过，exit 0，见 final-directed.log/.exit。两项检查均无原生或真实模型调用，也未改主区/原型产品源码。基线与原型计数差4项新增离线负例。

实际 provider text 投影解码后包含真实 U+000A 换行；源码字符串使用单个反斜线的 JavaScript `\n` 转义，不是两个字符的字面反斜线+n。verified-projections.json 中 JSON 序列化显示转义，但解析后的检查结果 actualNewline=true、literalBackslashN=false。报告中“下一行”与实际一致。

完成后冻结原型，等待主会话恢复指令。
