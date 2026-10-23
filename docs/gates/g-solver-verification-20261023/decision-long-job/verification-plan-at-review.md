# G：長作業完成交回验证 plan

**依据：** [G design](../specs/2026-10-23-design-v1-g-solver-minimal.md) §5.2、§7.2、§7.2.1。只验证该未定项，不把候选写成已采用。
**目标：** 比較同次工具持續等待與明確父子完成協議；不再把直接promptAsync恢復當成功。
**执行：** 专属 gpt-6.1-sol session，独立 worktree。原型代码从已核对的 g-c-rpc-slow-tools 工作区按需复制，保留来源/hash；当前 design 从主区复制，不使用 HEAD 的旧文档。

## 边界
- 不 commit/push，不合并或覆盖主区产品代码；不调用真实模型。运行仅本地fixture与loopback确定性替身。
- 允许本项必要可逆原型和无模型验证。Docker仅本任务命名资源，不改宿主网络/账户、不删其他任务资源；非root/无Docker socket等产品约束不得放宽。
- 先在自己的 design 写候选、问题与去向，再做验证；有外部契约/架构冲突或真实环境不足就报告，不虚构通过。
- 主要验证文件：tests/manual/g-long-job-decision.ts；按需定向 tests/contract/slow-tools.test.ts。只在对应路径做必要改动，不扩展别的未定项。

## 验证步骤
- [ ] 讀取既有 completion-probe 失敗及 job.run 契約；在自己工作區的 G design 先寫兩候選對 wait_ms、返回句柄及原 task 狀態的影響，不直接覆蓋既有契約。
- [ ] 以真實產品 launcher/plugin/C/OpenCode、loopback scripted provider 做最小候選探針；作業時間必須超過初始 wait_ms，保持原 task 至最終結果交回，完整記錄 session/call/job/provider 事件。
- [ ] 覆蓋取消、到期、重複通知、斷開、增量輸出與其他會話准入；不得用模型輪詢、自建provider循環、修改OpenCode或另建solver完成。
- [ ] 候選可行則回寫條件與建議契約；需改對外契約的選擇明列為提案，不冒稱已獲正式採用。都不成立則保留阻塞及具體缺失接口。

**完成判定：** 原等待任務收到最終結果且無輪詢，所有取消／交付邊界成立；否則未通過。

## 回写与收口
- 结论写回本工作区 G §5.2、§7.2.1、§9、§10：直接更新规则/候选去向，验证条件简记，禁止追加多轮执行日记。
- 必要证据放既有 docs/gates/g-solver-verification-20261023/decision-long-job/，保留失败、版本、输入来源、命令/退出码；未知、受阻和部分通过分开。
- 相关产品代码变化后做适用定向测试、typecheck/build/full suite；容器/文档检查按实际范围，不跑真实模型。
- 主session核对后只同步文档与证据，删除本已执行plan，不把结果累积回plan；未解决设计仍留design，计划删除不表示能力通过。
- 主session确认结果已保存后归档专属session，从活动列表移除；worktree保留，不合并、不commit，不永久删除证据。
