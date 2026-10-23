# G：宿主與會話 OS 隔離验证 plan

**依据：** [G design](../specs/2026-10-23-design-v1-g-solver-minimal.md) §3.4、§5.3、§5.4、§10。只验证该未定项，不把候选写成已采用。
**目标：** 先驗每會話uid／每題唯讀群組；不足再驗獨立執行環境。
**执行：** 专属 gpt-6.1-sol session，独立 worktree。原型代码从已核对的 g-c-rpc-slow-tools 工作区按需复制，保留来源/hash；当前 design 从主区复制，不使用 HEAD 的旧文档。

## 边界
- 不 commit/push，不合并或覆盖主区产品代码；不调用真实模型。运行仅本地fixture与loopback确定性替身。
- 允许本项必要可逆原型和无模型验证。Docker仅本任务命名资源，不改宿主网络/账户、不删其他任务资源；非root/无Docker socket等产品约束不得放宽。
- 先在自己的 design 写候选、问题与去向，再做验证；有外部契约/架构冲突或真实环境不足就报告，不虚构通过。
- 主要验证文件：tests/manual/g-os-isolation-probe.*；僅必要容器fixture。只在对应路径做必要改动，不扩展别的未定项。

## 验证步骤
- [ ] 讀取Docker/F現況並記錄原生ARM64、kernel、uid/gid、capabilities、mount；僅建立本任務命名容器與非秘密哨兵，不改宿主用戶或全局配置。
- [ ] 在非root產品約束下測兩題、同題兩會話：本題materials/published可讀不可寫、自己的work可寫；他題材料與他會話work、environ/memory和signal不可訪問。
- [ ] 核實控制狀態/provider/RPC/oracle哨兵隔離；宿主仍能發布、讀輸出、停止整個程序組，正向操作必須成功。
- [ ] 在同一候選環境實際觸發CPU和記憶體限制；記錄部署所需權限。候選需特權、Docker socket或宿主root常駐時明列衝突，不掩蓋。

**完成判定：** 同一ARM64環境通過全部正反向邊界才能選定；無可行非root路徑則保留阻塞。

## 回写与收口
- 结论写回本工作区 G §3.4、§5.4、§9、§10；必要時總design F：直接更新规则/候选去向，验证条件简记，禁止追加多轮执行日记。
- 必要证据放既有 docs/gates/g-solver-verification-20261023/decision-os-isolation/，保留失败、版本、输入来源、命令/退出码；未知、受阻和部分通过分开。
- 相关产品代码变化后做适用定向测试、typecheck/build/full suite；容器/文档检查按实际范围，不跑真实模型。
- 主session核对后只同步文档与证据，删除本已执行plan，不把结果累积回plan；未解决设计仍留design，计划删除不表示能力通过。
- 主session确认结果已保存后归档专属session，从活动列表移除；worktree保留，不合并、不commit，不永久删除证据。
