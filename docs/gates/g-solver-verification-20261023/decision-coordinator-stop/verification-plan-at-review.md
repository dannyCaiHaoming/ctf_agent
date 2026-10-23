# G：Coordinator 停止入口验证 plan

**依据：** [G design](../specs/2026-10-23-design-v1-g-solver-minimal.md) §7.1、§10；C §3、§5、§6。只验证该未定项，不把候选写成已采用。
**目标：** 比較受管停止工具與公開原生控制，沿用C可信父子關係。
**执行：** 专属 gpt-6.1-sol session，独立 worktree。原型代码从已核对的 g-c-rpc-slow-tools 工作区按需复制，保留来源/hash；当前 design 从主区复制，不使用 HEAD 的旧文档。

## 边界
- 不 commit/push，不合并或覆盖主区产品代码；不调用真实模型。运行仅本地fixture与loopback确定性替身。
- 允许本项必要可逆原型和无模型验证。Docker仅本任务命名资源，不改宿主网络/账户、不删其他任务资源；非root/无Docker socket等产品约束不得放宽。
- 先在自己的 design 写候选、问题与去向，再做验证；有外部契约/架构冲突或真实环境不足就报告，不虚构通过。
- 主要验证文件：tests/contract/g-coordinator-stop.test.ts；tests/manual/g-coordinator-stop-runtime.ts。只在对应路径做必要改动，不扩展别的未定项。

## 验证步骤
- [ ] 盤點公開原生task控制與現有host revoke；候選工具的參數、句柄來源、冪等及角色權限先寫自己G/C design，不以任意sessionID輸入作授權。
- [ ] 在獨立原型驗證Coordinator只能停止自己直接分派的child，其他角色、其他parent/run、偽造/過期句柄拒絕；重複停止不重複釋放。
- [ ] 接真實產品plugin/launcher/C/OpenCode+loopback替身，讓Coordinator發起停止正在HTTP/job等待的child，觀察孫進程回收、輸出保留及另一child繼續。
- [ ] 覆蓋完成/停止競態、unknown、已交付job及到期，保留C現有停止准入回歸；新對外工具契約明列候選驗證結果，不自動主線整合。

**完成判定：** 由Coordinator實際產品工具觸發且宿主權限/回收成立，不以直接測試調用revoke冒充完成。

## 回写与收口
- 结论写回本工作区 G §7.1、§9、§10；C能力/停止接口：直接更新规则/候选去向，验证条件简记，禁止追加多轮执行日记。
- 必要证据放既有 docs/gates/g-solver-verification-20261023/decision-coordinator-stop/，保留失败、版本、输入来源、命令/退出码；未知、受阻和部分通过分开。
- 相关产品代码变化后做适用定向测试、typecheck/build/full suite；容器/文档检查按实际范围，不跑真实模型。
- 主session核对后只同步文档与证据，删除本已执行plan，不把结果累积回plan；未解决设计仍留design，计划删除不表示能力通过。
- 主session确认结果已保存后归档专属session，从活动列表移除；worktree保留，不合并、不commit，不永久删除证据。
