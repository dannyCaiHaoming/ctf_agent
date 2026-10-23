# G：作業網路 scope验证 plan

**依据：** [G design](../specs/2026-10-23-design-v1-g-solver-minimal.md) §5.5、§10；總design §1.5、§3。只验证该未定项，不把候选写成已采用。
**目标：** 比較網路命名空間預設拒絕出口與受管代理；覆蓋腳本直接連線。
**执行：** 专属 gpt-6.1-sol session，独立 worktree。原型代码从已核对的 g-c-rpc-slow-tools 工作区按需复制，保留来源/hash；当前 design 从主区复制，不使用 HEAD 的旧文档。

## 边界
- 不 commit/push，不合并或覆盖主区产品代码；不调用真实模型。运行仅本地fixture与loopback确定性替身。
- 允许本项必要可逆原型和无模型验证。Docker仅本任务命名资源，不改宿主网络/账户、不删其他任务资源；非root/无Docker socket等产品约束不得放宽。
- 先在自己的 design 写候选、问题与去向，再做验证；有外部契约/架构冲突或真实环境不足就报告，不虚构通过。
- 主要验证文件：tests/manual/g-network-scope-probe.*；隔離fixture。只在对应路径做必要改动，不扩展别的未定项。

## 验证步骤
- [ ] 盤點現有網路邊界，建立本任務專用本地容器網路、授權與越界服務；不得改宿主防火牆、VPN、代理或現有容器。
- [ ] 候選先寫入自己G design，驗證同題授權入口可達、他題/控制服務/宿主及未授權地址不可達；使用curl、Python socket、直接TCP、UDP、IPv6、DNS及繞過proxy環境對照。
- [ ] 核實DNS變更/重導向與共享origin情況，區分G HTTP origin核實和網路IP/port規則；不能把代理可用當成直連已阻斷。
- [ ] 記錄ARM64、非root、namespace/capability及建立規則所需權限；對瀏覽器未執行路徑不宣稱覆蓋，與OS隔離方案相容性列清。

**完成判定：** 授權正向可用且所有本輪直連繞過被阻止才成立；缺前置或只驗部分協議須明示未通過範圍。

## 回写与收口
- 结论写回本工作区 G §5.5、§9、§10；總design網路待決項：直接更新规则/候选去向，验证条件简记，禁止追加多轮执行日记。
- 必要证据放既有 docs/gates/g-solver-verification-20261023/decision-network-scope/，保留失败、版本、输入来源、命令/退出码；未知、受阻和部分通过分开。
- 相关产品代码变化后做适用定向测试、typecheck/build/full suite；容器/文档检查按实际范围，不跑真实模型。
- 主session核对后只同步文档与证据，删除本已执行plan，不把结果累积回plan；未解决设计仍留design，计划删除不表示能力通过。
- 主session确认结果已保存后归档专属session，从活动列表移除；worktree保留，不合并、不commit，不永久删除证据。
