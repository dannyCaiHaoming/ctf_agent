# G：受保護目標操作验证 plan

**依据：** [G design](../specs/2026-10-23-design-v1-g-solver-minimal.md) §10；總design §1.4；E §2、§6。只验证该未定项，不把候选写成已采用。
**目标：** 核實可信操作描述與通用G HTTP的責任邊界，避免全工具審批。
**执行：** 专属 gpt-6.1-sol session，独立 worktree。原型代码从已核对的 g-c-rpc-slow-tools 工作区按需复制，保留来源/hash；当前 design 从主区复制，不使用 HEAD 的旧文档。

## 边界
- 不 commit/push，不合并或覆盖主区产品代码；不调用真实模型。运行仅本地fixture与loopback确定性替身。
- 允许本项必要可逆原型和无模型验证。Docker仅本任务命名资源，不改宿主网络/账户、不删其他任务资源；非root/无Docker socket等产品约束不得放宽。
- 先在自己的 design 写候选、问题与去向，再做验证；有外部契约/架构冲突或真实环境不足就报告，不虚构通过。
- 主要验证文件：tests/contract/g-protected-operations.test.ts；本地HTTP fixture。只在对应路径做必要改动，不扩展别的未定项。

## 验证步骤
- [ ] 只讀核對D/E/平台既有接口；比較由可信adapter描述受保護操作與G通用端點推斷，候選先寫自己design。
- [ ] 建立本地GET啟動計時、POST純觀察、限次操作及發送後斷線fixture，證明HTTP方法/模型自述不足以決定副作用。
- [ ] 以最小host原型驗證可信描述來源、意圖先存、結果unknown不自動重發且只阻止受影響操作；普通觀察保持可用。不得操作真實平台或實際計時靶場。
- [ ] 確認是否需要修改E清單或D契約；缺可信描述時如實保留待D/E解決，不把範例adapter泛化成G能自動識別任意目標端點。

**完成判定：** 得到可被證據支撐的責任/契約結論；外部依賴未定不得宣稱完整保護已實作。

## 回写与收口
- 结论写回本工作区 G §10與相關正文；必要時E/總design：直接更新规则/候选去向，验证条件简记，禁止追加多轮执行日记。
- 必要证据放既有 docs/gates/g-solver-verification-20261023/decision-protected-operations/，保留失败、版本、输入来源、命令/退出码；未知、受阻和部分通过分开。
- 相关产品代码变化后做适用定向测试、typecheck/build/full suite；容器/文档检查按实际范围，不跑真实模型。
- 主session核对后只同步文档与证据，删除本已执行plan，不把结果累积回plan；未解决设计仍留design，计划删除不表示能力通过。
- 主session确认结果已保存后归档专属session，从活动列表移除；worktree保留，不合并、不commit，不永久删除证据。
