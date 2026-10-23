# G-V1 跨轮选题与分派验证（2026-10-23，Asia/Tokyo）

结论：修订 G-V1 的最小协议切片通过。T1–T9 的可控 Promise／SDK 替身测试通过；真实 OpenCode 1.19.3 的 T1、T5、T7 两种顺序、T8 登记前与登记后失败通过。只证明控制服务原型协议和真实原生 task 的对应时序，不代表 G 全部完成或正式产品插件接线。

## 基线、范围与配置

- 独立工作区：`/Users/caihaoming/.codex/worktrees/g-v1-cross-round/pentest-agent`；HEAD `d83a0c3024271dbf212db319e900fcf527e68b0f`，native managed worktree，detached HEAD，未提交。
- 主工作区来源：`/Users/caihaoming/Documents/pentest-agent`，`main`。初始状态、当前适用 AGENTS、G plan、G/C/E/总 design 等文档的来源与 SHA-256 见 `baseline.json`。复制的是当时磁盘文件，不是旧 HEAD 的版本；AGENTS、C 和总 design 相对 HEAD 的差异属于基线复制，不是本轮新设计。
- 旧工作区全程只读；原 REPORT 与 A 失败、B 同轮通过证据逐字节复制到 `historical/`，来源与 hash 见 `historical-source.json`。历史文字（包括已撤回的通过判据）保持原样，仅供历史，不是本轮通过依据。
- 依赖：`npm ci` 在 run 外准备；Node v26.3.0，OpenCode `/Users/caihaoming/.opencode/bin/opencode` 1.19.3（每次由 startManagedOpenCode 校验），SDK/plugin 1.19.0，Vitest 2.1.8。开发执行模型按用户指定为 gpt-6.1-sol；这不是求解 provider。
- 所有 runtime 都使用 `enabled_providers: [stub]`、`model/small_model: stub/scripted`，adapter 为本机已安装的 `@ai-sdk/openai-compatible`，唯一 baseURL 是当次 `127.0.0.1` HTTP 替身。每次配置存于 `runtime/<attempt>/config.json`。
- 复用 startManagedOpenCode 的环境白名单、临时 HOME/XDG、禁项目配置、默认插件、外部 skills、模型列表下载及在线依赖安装；仅传临时 RPC 凭据与非秘密替身 key。不读取 `.env`、用户 provider key 或旧工作区凭据。配置证据中的 RPC token 已抹除。
- 真正求解模型 token 预算 **0**，真实模型调用与消耗 **0**。替身显式返回的 usage 也是 0，但不据此推断真实 provider 的计费；没有真实 provider 可被选用。未做 OS 抓包，不将配置隔离表述成全系统出站网络隔离证明。
- run 输入 X/Y 由 E 的 `prepareRun` 实际准备，离线题、无目标连接；`preparation.json` 保留材料路径/hash。父子关系由真实 SDK 查询，工作区创建／文件工具不属于此次切片。

## 原型修改与 T1–T9

`apps/launcher/src/control-service.ts` 新增独立宣告表、assign/unassign 预检与执行、pending 题目、固定 challengeId、恢复核对及终止清理。预检不写入；execute 成功才写宣告；无 await 的短串行状态变更不依赖同轮工具发起顺序。未知子会话的 SDK 异步查询返回后仍检查父会话有效性。到期清理在访问有效性检查时惰性执行；到期期间任何访问都拒绝，不重新激活。

| 判据 | 确定性结果 | 覆盖与限制 |
| --- | --- | --- |
| T1 | 通过 | assign execute → 父再次准入 → task → X 绑定 → 子准入 |
| T2 | 通过 | before 预检不生效，自由文字题号无效；无 pending/子绑定，之后明确 assign 可恢复 |
| T3 | 通过 | 同题/异题重复拒绝并保留 X；unassign 幂等；pending 不可取消；清除后可声明 Y |
| T4 | 通过 | 跨两次父准入保留；停止/撤销/到期清除；撤销 Coordinator 测试使用受控绑定终态，现有公开 revoke 只接受子会话 |
| T5 | 通过 | 无声明、同题恢复不建 pending；异题/外来拒绝且保留；原会话 X 不变 |
| T6 | 通过 | 非 Coordinator、四个 run 范围角色、其他 run 题目拒绝 |
| T7 | 通过 | Promise 屏障令 task 先到并拒绝；稍后 assign 成功，下一轮恢复；完成 assign 后 task 正向 |
| T8 | 通过 | 缺 callID 登记前拒绝保留；登记后无子 hook/after 的失败，下一准入只清 pending；无自动宣告恢复；重新 assign Y 成功 |
| T9 | 通过 | SDK 查询/队列屏障中停止，或受控撤销/到期，释放后不建宣告、pending、有效子绑定；无睡眠猜竞态 |

G 新增 14 个用例（T4/T9 各含参数化终态）。既有 C fixture 显式提供 G 声明，保留原身份/预算断言；Intake fixture 补声明；launcher evidence fixture 经真实 RPC 先声明，仍使用原产品 hooks，未修改产品插件的 G 注册或 launch 接线。没有新增测试专用生产接口。

## 真实 OpenCode runtime

本轮共 7 次 runtime（6 次完整通过、1 次 T5 上限失败），合计 50 次替身请求／准入，全部保留，真实模型 token 0。

每个成功场景在同一个 runtime 中核对 callID、sessionID、审计 seq、绑定和替身请求快照；不跨运行拼接成功。`verified-results.json` 对留存证据再核对：每个子请求的控制快照已包含固定题目绑定及相应次数的准入，绑定 seq 小于首次准入 seq。

| attempt | 结果 | 关键序列（均为该次 control-audit seq） | 替身请求/准入 |
| --- | --- | --- | --- |
| T1-1 | 通过 | assign 5 → 父准入 8 → register 9 → bind 11 → 子首次准入 13 | 4/4 |
| T5-2 | 通过 | bind X 11；resume 17/29/50 的声明消费为 false/true/false；外来及冲突拒绝 41/43；unassign 46；只有一次新 register、同一子会话 4 次请求 | 15/15 |
| T7-early-1 | 通过 | task 拒绝 5 → assign 6 → 下一轮 register 10 → bind 12 → 子准入 14 | 4/4 |
| T7-late-1 | 通过 | assign 5 → 同轮 register 7 → bind 10 → 子准入 12 | 3/3 |
| T8-1 | 通过 | register X 9 后 RPC 在返回 native task 之前注入失败；下一准入 release 11；无声明重试被拒；重新 assign Y 16 → register 20 → bind Y 22 → 子准入 24 | 7/7 |
| T8-pre-1 | 通过 | RPC 在首个 task 登记前注入失败；原 X 声明跨轮仍能注册并绑定，只有 1 次 assign、1 次 register、无 dispatch.release | 5/5 |

T7 用 RPC 屏障控制两个有效顺序：early 把 assign.execute 卡在控制服务入口外，直到 task 拒绝；late 把 task.before 卡到 assign 成功。不把可控注入的顺序称为 OpenCode 原生顺序保证。T8 的注入是 RPC 边界上的明确错误，真实 OpenCode 因 hook 失败跳过 task 执行、进入下一轮；不是伪造 task.after，也不是模拟已发生的自然 native task 内部故障。T8 登记后失败的 callID 没有 task.correlate；失败后恢复都在各自同一个 runtime 中完成。

## 保留的失败与必要修正

1. `red.log`：添加回归、实现前，17 项既有 C 测试通过、14 项 G 用例失败；缺少声明能力是主要失败，T9 的状态缺失断言亦因原实现没有宣告表而失败。没有伪造额外的基线全套通过记录。
2. `tests.log`：首次全套 231 通过、6 失败，均在 `launch-evidence.test.ts`：normal success、SDK read failure、children/export failure、original+close errors、unbound descendant usage。原替身直接分派 recon、没有 G 声明，失败发生在其原目标断言前。只补声明前置条件；`launcher-fixture-regression.log` 12/12，通过后 `tests-final.log` 全套 237/237。
3. `runtime/T5-1` 与 `runtime-T5.log`：T5 继承旧探针 maxModelCalls=12，在 unassign 后下一次准入被 budget 拒绝，只有 3 次子请求，原断言 3 != 4。该次失败和全部 12 次替身准入/请求保留，没有从总消耗排除。按脚本长度+10设置无模型准入上限（T5=20），原脚本、topic、task_id 与 4 次子请求断言不变，T5-2 同次 runtime 完整通过。此修正不改变任何真实模型预算或 provider。

## 检查与剩余范围

- 定向控制服务/Intake：39/39；launcher evidence：12/12；全套 `npm test`：33 文件，237/237。
- `npm run typecheck`、`npm run build`、scratch 探针单独类型检查均退出 0；`git diff --check` 通过。日志见当前目录；runtime 有 Node module.register 弃用警告，未影响执行。
- 独立只读代码评审未发现 actionable 缺陷，未重跑 provider；评审后仅补充 T8 登记前 runtime 注入与取证，不改产品原型逻辑。
- 尚未验证：产品插件正式 G 工具注册、launcher G 工具清单、绑定时创建解题工作目录、G-V2–V7 的补验、全 G 受管工具接线、OS/网络隔离、真实模型使用与协作/解题能力。这些保持原状态，没有以本次结果替代。
- T2/T3/T4/T6/T9 本轮没有真实 OpenCode runtime 验证；它们只以可控 Promise／SDK 替身回归通过陈述。协议要求的 runtime T1/T5/T7/T8 已对应上表，均未用单元成功替代。
- 未合并、未 commit/push、未启动下一切片。主工作区和旧工作区未写入。
