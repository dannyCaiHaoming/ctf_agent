# 最终独立只读复核

## Verdict

计划合规：通过，附下述覆盖限制。证据质量与设计回写：通过，无阻断项，没有发现需要扩大本轮实施范围的问题。

## 本轮追加核对

已读取 child plan、report、minimal-evidence、probe 与 network policy；核对详细 design §7、核心设计 C/E 链接、docs/superpowers/README 对应行及持久证据说明。没有重跑测试或探针，没有读取原始真实运行记录、完整配置、私有 oracle 或 reasoning，没有修改产品文件。

child 最小投影中，两组各8个本地请求、failure=null；同一个 child 的两轮 assistant 分别有独立 user parentID，结果为 length/13字符→stop/15字符和 length/0字符→stop/15字符。探针仅用公开 SDK 读消息，输出投影排除 reasoning。网络策略与之前 root 相同，只放行 localhost 出站；干净 env 与 HOME/XDG 可从脚本确认。外联 EPERM 的实际执行、版本和清理结果依据执行报告，未在本复核重跑。

纯 OpenCode 探针未加载产品 plugin/ControlService，因此只能证明原生消息事实与SDK可读性。产品 call/ref/notice 的绑定来自源码检查与既有替身层，不能拼成同次联合运行证明。详细 design §7.4 和持久证据 README 已明确补上这一边界，复核确认文字存在。

通知瞬间SDK可见性、自然重复通知、停止竞争、缺消息和call/ref→child user可靠关联均未证明；报告和§7.4保留unknown，没有把最新消息读取定成可行方案，也没有引入result-ref或自动恢复。这满足plan允许的“记录具体unknown”，不是完整关联验收通过。

## 证据到设计的判断

仅 root 最终报告完整性与展示进入最小实施集合是适当范围：真实runtime已复现length仍completed，现有launcher源码的历史任意completed判断支持取消息规则修正；五例SDK替身与原生证明明确分开。新增rootResult、同一事实源驱动progress、保留CLI退出码和shutdown aborted显示、未知关联不猜测的决策符合当前证据。root父输入/assistant的复合事件及同时到达仍是实施定向测试要求，文档没有称已验证。

readiness缺少可信准备记录生产者及专用检查判据，因此不选A/B、不进入本轮实现合理；未来要求检查的真实run应由准备流程阻止，不声称产品guard已存在。Critic B仅是事实应可见的方向，等待子任务绑定验证；不独立增加调度、提示词或权限。核心C/E和README与这些状态一致。

独立计算持久目录manifest的21条文件hash，全部匹配。证据README明确临时绝对路径和复现需重新建立隔离位置，不把持久目录冒充可直接执行的产品gate。

## 限制

本复核证明白名单材料内部一致、脚本所能支持的结论层次和设计收敛正确；未独立重跑基线/探针、验证OS执行日志、重算137文件源码快照、核对所有原始运行时输出或确认最终进程清理。上述事项由主会话另行核对，不能借本报告扩大证明范围。没有产品修复、真实模型行为、readiness新机制、子任务可靠绑定或solved的验收结论。
