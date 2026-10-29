# Recon slice 2（第二切片）：per-recon 强制探索边界 + 受限收束

日期：2026-10-29。依据：[Recon 重设计 §10.3](../superpowers/specs/2026-10-29-design-v1-recon-redesign.md)（受限 closure 机制），红线见同设计 §10.1、§5；上位 V1／AGENTS／CLAUDE。一次性交接物，只有本 plan 引用 design。**本次仅写草案，获授权后才实施。**

## 0. 当前一步：给 Recon 一个 host 强制的探索额度 + 收束窗口

**卡点**：r11／r12 两轮 recon 都写了「有界回合、及时交回」却仍深挖到全局 deadline（r12 slice-1 的短骨架＋skill＋记录约定被模型直接无视，R12:23–71）。prose 绑不住模型；需要 host 在既有 admission／Execution 上机械地：探索额度耗尽即进入**受限收束**（仍能整理、读已有结果、发布、交回），收束也耗尽才停止该 Recon，且**不 stopAll 整队**。这是设计 §10.3 的已选方案，不是重新讨论是否要 host 兜底。预算可见快照（§10.6）与字形能力（§4 独立轨道）**不在本切片**。

**本切片只做 §10.3**；maxToolJobs（上一切片已接线）、交接 wording（上一切片）不在此重做。

### 文件与职责（获实施授权后）

| 文件 | 本步作用 |
| --- | --- |
| `apps/launcher/src/control-service.ts` | 在既有 RunBudget／Execution／admission 上加 per-recon 探索额度与收束状态：①按 host 计数的 model.call 步数额度（墙钟可选，仅复用既有 deadline 检查，不新增 timer）；②归属到当前 Recon 的 run/challenge 累计配额，复用或新建 Recon session **不重置**（防 Coordinator 借续接绕过）；③设总额度 B、收束预留 R（0<R<B），探索最多 B−R，收束用 B 内剩余；④探索额度耗尽进入 closure：在 `tool.before`（~:500–515）与 execute（~:692–715）两处重查，**拒绝新探索入口**（job.run、http.request、workspace.view、search/diff、skill/read），**放行** 本会话 workspace.list/read/write、job.read/cancel、artifact.publish/read 及最终文字交回所需 model.call；拒绝消息带可读的 closure 原因（现有 RPC 只透传 message）；⑤收束也耗尽：复用既有 stopChild／cancel，保留 unknown，父 Coordinator 得到局部 stop 原因与可确认 ref，不是裸 abort；⑥全局 deadline／model-token／显式 stop 始终优先，窗口不延长总预算。 |
| `apps/launcher/src/launch.ts` | 把 Recon 探索额度与收束预留从既有 profile 预算传入 RunBudget；不新增 timer 服务、不改默认值。 |
| 预算 profile／类型（如 `apps/cli/src/composition/releaseProfile.ts` 或其对应配置类型） | 仅为上面两个值加可配置字段并校验；**不在本 plan 指定具体数字**（r11/r12 的 3–5 分钟是未批准估计）。未配置时该 bound 为 unavailable、不启用，不伪造额度。 |
| `tests/contract/`（既有控制层／slow-tools 测试档） | 用真实 ControlService 补：探索额度内放行；额度耗尽后新探索入口被拒且不 spawn、workspace.read/write 与 artifact.publish/read 仍放行；收束耗尽按既有 stopChild 结束且保留 unknown、不 stopAll（其他角色调用不受影响）；续接／新建 Recon session 不重置配额；in-flight job 在软边界不被假装完成。不新建 fixture 目录／gate。 |

### 行为判据（继承设计 §9、§10.7，按行为非措辞）

1. **探索被机械地止住。** Recon 的 host 计数 model.call（或配置墙钟）达 B−R 后，新的 job.run/http/view/search/skill 在 before 与 execute 两处都被拒、无 spawn，返回可读 closure 原因；不靠模型自觉。
2. **收束出口仍开。** 进入 closure 后 workspace.list/read/write（本会话）、job.read/cancel、artifact.publish/read 及收束用 model.call 仍放行；Recon 能固定已有材料并经原生 task 交回真实 ref。收束额度 R 用尽才停。
3. **不误伤全队、不重置。** 局部耗尽只停该 Recon、绝不 stopAll；Coordinator/Solver/其它题调用与预算不受影响；同 run/challenge 续接或新建 Recon session 不重置已用配额。
4. **in-flight 与优先级。** 已准入的 job/HTTP 不因进入软边界假装完成，异步等待后重查；全局 deadline、model/token 上限、显式 stop 始终优先，closure 窗口不延长总预算。硬停复用既有 stopChild／cancel 并保留 unknown，父得到局部原因与可确认 ref。
5. **静态与机制分报。** 无模型 contract/typecheck/build 证明机制；真实模型是否在 closure 内正确发布并交回仍 **not run-verified**，需后续授权 run（与上一切片的交接、maxToolJobs 同次验证）。不以测试绿宣称 recon 时间问题已解或 solved。

不固定 B、R 或分钟数；不预排后续切片。

### 禁做

- 不实现 §10.6 预算可见快照、§4 的 OCR／视觉／转写能力；不改 maxToolJobs（已接线）、JobManager 并发语义、交接 wording（上一切片）、plugin、artifact transport 或其他 budget 校验器的既有语义。
- closure 耗尽**绝不 stopAll**；不新增 scheduler／monitor／watchdog／wakeup／timer 服务／framework／DAG／planner；不切 async（若严格局部墙钟必须中断在途模型调用才可行，停下交回设计，不自行改 async，见设计 §10.3 窄待验证点）；不 fork OpenCode、不直连 provider。
- 不硬编 B／R／分钟数或题目专属值；不把 3–5 分钟当默认；不降低既有隔离／来源／分页／unknown 完整性。
- 不新增 fixture／gate／轨迹／里程碑；不让 recon 成为 planner；不注入题解、候选、flag、oracle 答案；记录／摘要不含凭据或私有答案。
- 不删除既有工作、不 commit／push、不联网、不跑 challenge、不改其他角色文件或父 design；发现其他缺陷如实交回不就地修。

### 授权范围与执行模型

**当前授权仅为本 plan 草案。** 获明确实施授权后才改上述文件并做无模型验证（`npx tsc --noEmit`、`npm run build`、`npm run test:deterministic`、`npm test`）。真实模型行为验证须另授权（目标/provider/token/批次/deadline），一次 run 不自动授权下次；与上一切片的交接＋maxToolJobs 同次观察，不拼不同 run 的局部结果。实施在隔离 worktree／独立 session。

**执行模型：GPT-6.1-sol（高 effort）/ Sonnet 5.5 或更高。** 理由：涉及 ControlService 的 admission／Execution／closure 状态机与竞态，是运行时判断，非机械改文档（`CLAUDE.md:37–43`）；B/R 语义与严格墙钟取舍留给设计者审核，不由执行者擅定。

## 1. 结果记录（执行后填写）

当前仅草案；无实现、无测试执行、无 run。执行者在此记录实际改动、机制测试结果与失败；真实行为逐项记 not run-verified。结论归入设计 §10.3 后再按规则处理本一次性 plan。
