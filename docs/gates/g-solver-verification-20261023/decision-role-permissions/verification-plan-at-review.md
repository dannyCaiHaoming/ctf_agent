# G：Intake 寫入與 Verifier HTTP验证 plan

**依据：** [G design](../specs/2026-10-23-design-v1-g-solver-minimal.md) §6、§10；C §5；E §4；總design H/1.3。只验证该未定项，不把候选写成已采用。
**目标：** 驗證維持現有最小權限是否足夠；D重放模式未定不能默認給HTTP。
**执行：** 专属 gpt-6.1-sol session，独立 worktree。原型代码从已核对的 g-c-rpc-slow-tools 工作区按需复制，保留来源/hash；当前 design 从主区复制，不使用 HEAD 的旧文档。

## 边界
- 不 commit/push，不合并或覆盖主区产品代码；不调用真实模型。运行仅本地fixture与loopback确定性替身。
- 允许本项必要可逆原型和无模型验证。Docker仅本任务命名资源，不改宿主网络/账户、不删其他任务资源；非root/无Docker socket等产品约束不得放宽。
- 先在自己的 design 写候选、问题与去向，再做验证；有外部契约/架构冲突或真实环境不足就报告，不虚构通过。
- 主要验证文件：tests/contract/g-role-permissions.test.ts；按需產品runtime替身。只在对应路径做必要改动，不扩展别的未定项。

## 验证步骤
- [ ] 核對E Intake交付及D Verifier三模式需求，列出必須操作與權限來源；目前Intake唯讀、Verifier本地重算是基線。
- [ ] 用真實產品權限配置/C與本地fixture驗證Intake可列題讀材料、不能寫；Verifier可私有work重算且不能寫材料/他會話或直接HTTP。
- [ ] 對HTTP重放建立最小可信模式候選，核實scope/cookie/證據及一次性操作限制；不在缺D驗證模式時直接開普通HTTP權限。
- [ ] 結論應區分現有最小版可維持、H文字需對齊、D相鄰能力待定。真實模型必要性不可由stub結論取代。

**完成判定：** 維持或調整權限有具體工作流證據；模式未定則保持拒絕並列依賴，不為完成驗證而擴權。

## 回写与收口
- 结论写回本工作区 G §6、§9、§10；必要時C/H/E：直接更新规则/候选去向，验证条件简记，禁止追加多轮执行日记。
- 必要证据放既有 docs/gates/g-solver-verification-20261023/decision-role-permissions/，保留失败、版本、输入来源、命令/退出码；未知、受阻和部分通过分开。
- 相关产品代码变化后做适用定向测试、typecheck/build/full suite；容器/文档检查按实际范围，不跑真实模型。
- 主session核对后只同步文档与证据，删除本已执行plan，不把结果累积回plan；未解决设计仍留design，计划删除不表示能力通过。
- 主session确认结果已保存后归档专属session，从活动列表移除；worktree保留，不合并、不commit，不永久删除证据。
