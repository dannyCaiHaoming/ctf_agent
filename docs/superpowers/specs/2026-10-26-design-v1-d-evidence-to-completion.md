# design v1 D：从原始证据到可信完成

日期：2026-10-26（Asia/Tokyo）。状态：**本次最小工程修复已完成；真实模型效果待验。已完成同输入无模型离线可读性验证：原引用入包可保留精确 bytes／来源；HTTP 必要事实已关联，读取复用 manifest。原引用角色修正及最小 HTTP 接口已实现并通过无模型检查，2026-10-27 核对后整合至主工作区（§5.2）；path 缺少非秘密证明而省略，具体 endpoint 仍未知。模型行为与可信完成未验证。** 本文是[核心 design v1](2026-10-22-ctf-agent-design-v1.md) D 的详细子文件，细节以本文为准。既有 [D 最小设计](2026-10-24-design-v1-d-candidate-verification-minimal.md)继续负责固定候选、版本、独立验证与可信提交；不改其门槛。

## 1. 问题背景与已核对证据

原 run：`/Users/caihaoming/Documents/pentest-agent-run-data/throwback-debug-20261026-r4/runs/throwback-debug-20261026-r4-1/`。OpenCode 1.19.3，模型 `volcano-coding/deepseek-v4-1-flash-261017`；`state/run.json` 为 HEAD `89e47dde` 且 productDirty=true，不能用该提交号替代实际运行源码／配置。当前审查基线为主区 `fb8f618b` 加已有文档改动；参数继承、进度与路径接入已由 `b1afa29a` 收口，不属于本次新修复。

下列路径相对原 run。只读核对对象为 `evidence/publications.json`、`verification-results.json`、`completion-results.json`、角色消息，以及最终包和准备目录；没有重跑原题、执行包内脚本或修改历史证据，不将候选值写入产品文档。

### 1.1 证据复制发生在准备之前

最终包为 `0fc41d40-e254-407a-ad93-3c38858d3c43`，对应 `workspace/throwback/published/<version>.bin`。以下原件与副本的实际 bytes／发布 hash 均已核对，准备目录采用 `verify-b53d4e3d-3671-4319-86b0-37352ac9429c/inputs/`。

| 包内路径 | 原发布 ref／事实 | 包选中的 ref／事实 | 观察 |
| --- | --- | --- | --- |
| `evidence/endpoint_delete.bin` | `95865a2c-a11f-4c11-a4c3-0423219b158a`，http，26 bytes，originalComplete=true | `e0e1ae19-eaad-4e49-a91e-4ba70c9e6a7d`，file，26 bytes，originalComplete=null | bytes 相同，但副本不能继承原 HTTP 来源；candidate 本身仍使用原 HTTP ref |
| `evidence/936eee7e-ad93-4b6f-87e1-f4afd590a63f.bin` | 同名原 ref，http，6218 bytes，originalComplete=true | `e4630233-e8b8-4344-9792-6a1b50cfe491`，file，6230 bytes，originalComplete=null | bytes 已改变；报告解释为控制字符转写，本次只确认差异，不由长度反推全部转换原因 |
| `evidence/4b81343c-743d-459f-97d1-c4b6dfef414d.bin` | 同名原 ref，http，2638 bytes，originalComplete=true | `32bbcebc-d1ea-468d-9f1f-e79dc82aba5f`，file，2638 bytes，originalComplete=null | bytes 相同，来源仍是副本 |

上述准备后 bytes 均等于包选中的副本，不是 `package.prepare` 复制损坏。`CandidatePackages.publish` 已允许 files 直接选择原 artifact ref，manifest 保留 publication/source；prepare 按 manifest 路径复制固定 bytes，不要求 Engineer 先复制再发布。

### 1.2 分派内容与宿主元数据是两个不同断点

- Engineer 消息 `evidence/messages-ses_e8c480d65ffeMXahwsrKQNva6r.json` 的初始任务给出原 HTTP ref，却要求复制到本地 evidence、更新说明再冻结新版本。角色随后重新发布文件并选进包。已证实存在不必要的复制路径；不据此断言全部复制行为都只由这一条提示造成。
- Verifier 消息 `evidence/messages-ses_e8c467a92ffeZ8nDKrwwc0ycvr.json` 的初始任务规定读取顺序、`recompute`、10 次调用内登记及至少要填写的 premises/issues，并要求不要先探索 published；续接又指定这些字段。它没有明文禁止所有原 ref 读取，但实际没有 artifact.read/package.read 调用，主要读取 prepared 文件。独立判断结论虽仍被允许，方法与必要前提的选择空间已被上游收窄。
- 原 HTTP call `call_00_shgjtvm0g55sv2owl6utotsk` 的回复含 status=200、响应头、redirectChain 和完整的 26-byte body。当前 `http-tools.ts` 把这些事实返回来源角色，`control-service.ts` 的 outputSources 只接入 bytes、complete 及调用身份；`ArtifactSource` 没有 HTTP 状态／目标／采集时间字段，`ArtifactPublisher.read` 还排除内部 source。manifest 能保留已有 source，但不能恢复从未进入该来源记录的 HTTP 上下文。因此读取原 body 也不能自动解决状态／目标核对。

### 1.3 有效结论与报告声明

两份报告的 candidateEqual 均为 true、effectiveJudgment 均为 inconclusive，completion 记录为空。最终报告 original.judgment=verified，同时有 unknown premises、未解决 issues，且 declaredDependenciesOnly=true 而依赖状态 unknown。宿主记录四类 blocker：`required premise unknown`、`unresolved verifier issues`、`necessary source incomplete or unknown`、`undeclared dependencies unknown`。

`verification-results.ts` 的拒绝符合现行契约。换回原引用只能针对其中的来源问题，不能消除其他 blocker；不得先决定让原报告通过，再反向删除字段。

## 2. 唯一目标与预期效果

让真正支持候选结论的原始证据、必要事实与独立判断沿现有链路可读、可核对。减少无必要复制、转码、重复发布和重包；证据足够时能继续现有 completion，确实不足时准确交回最小缺口。

本次不是保证 Throwback solved，也不是全面重构 D。是否 solved 仍按核心 1.3 的有效验证与权威裁判判定；没有权威裁判时不把本地比较当接受。速度收益目前只是预期，不以减少工具调用数替代有效结果。

## 3. 已确认的修复方向

### 3.1 原引用入包，衍生材料分开

Coordinator 交付真实原 ref、用途与缺口，不要求所有证据先复制再发布。Engineer 对未改动证据直接用原 artifact ref 和包内相对 path 组织 files；由现有 prepare 映射到执行目录。新增脚本、说明和确需转换的结果才发布新产物。转换时保留原引用和转换说明，不能因 bytes 相同或 hash 相同把 file 来源改成 http。

现有接口足以表达上述选择；本次已用真实原失败材料完成离线 publish／read／prepare 对照，保留 bytes／来源，见 §5.1。角色使用修正已在本轮接入，工程检查见 §5.2；原离线结论不代表模型遵循。不得把“直接入包”扩大为不读材料，也不禁止必要的本地分析或衍生文件。

### 3.2 Coordinator 交目标，Verifier 决定证明方法

Coordinator 交固定 version、待核实主张、原证据索引、已知缺口及有效预算；不替 Verifier 预填 mode、必要 premises/issues，不用固定操作顺序替代独立判断。允许说明已尝试的方法与限制，允许给出预算内的执行边界；不由本次修改扩大真实调用预算。

Verifier 先确定要证明的具体结论：采集时观察、固定材料推导、当前状态或可重复性，再选择方法和必要条件。区分 load-bearing 前提与不影响该结论的背景限制；确实必要的 unknown、相关未解决问题与依赖要求继续阻断。按既有 D §6 的显式受信任前提处理条件性判断，不能把 unknown 改成 assumed 作为过关手段，不能将 requirements 设为 false 隐藏实际依赖。

报告必须与自己声明的条件一致；缺必要条件就 inconclusive。现有 schema／校验保留，不新增语义判断器。若当前结构确实无法表达所需合法结论，记录具体表达缺口后再决定，不能将所有限制都塞入必阻断字段，也不能擅自丢弃限制。角色方法说明已在本轮接入，不代表模型会正确执行。

## 4. 离线结论：最小 HTTP 事实关联，复用 manifest 读取

选择“在既有来源记录补最小可信字段”分支，**该接口已在本轮最小实现，见 §5.2；本节以下保留实现前离线定位的证据语境**。最短丢失边是 `http-tools` 完整响应 → `control-service.outputSources`：后者只保存 bytes／complete 和来源身份；publication 的 source 没有 HTTP 上下文。`artifact.publish/read` 还隐藏 source；`package.read(manifest)` 及 prepare 后的 manifest 已可保留 source，但不能恢复未记录的字段。`package.read(file)` 只交付固定 bytes，不补这些元数据。Verifier 无普通 HTTP、audit 或其他 session 读取权限；开发调试消息可见不等于角色可读。

下表的“当前可达性”指原离线定位时点，并非本轮实现后的字段状态。三条实际 tool 记录分别为 POST／GET／GET，均只有一个实际请求 hop，状态 200、选定 Content-Type 为 `text/html; charset=utf-8`、body 未截断。按原 session／callID／resource 关联，保存 body 与 publication bytes／hash 相等；请求 origin／path 与该 hop 对上，无 query／fragment。未导出目标值、请求 body、preview 或整份 headers。

| 字段 | 必要主张与原始观察 | 当前可达性／最小决定 |
| --- | --- | --- |
| body 所属 hop 的实际 method | 区分 endpoint 操作与源代码页面读取；host 的 `currentMethod` 决定真实发送方法 | publication／manifest／允许读取中均缺；补实际 body hop 方法。初始 `args.method` 不是通用替代，不为调试另加完整方法历史 |
| 去敏目标标识／path | 报告要求确认 endpoint 和两份源页面的来源；host 读取请求 URL、最终 current URL 及 redirectChain | 当前只在来源角色 tool 回复／输入中，未随 ref 交付；补 host 绑定 scope 的非秘密目标表示及去敏标记。秘密 path 或 query 语义不能安全交付时保留身份缺口，不能用不透明标识声称已核实具体路径 |
| 同一 body hop 的 status | 原报告明确将“status 200 未审计”列为 unknown／issue；host response.statusCode 已观察 | 当前缺；随同一 capture／resource 记录最终 status，不混配其他 hop。200 仍不证明业务成功 |
| 必要的 Content-Type | 原报告的 HTML／内容类型主张需要它；不是 raw bytes 相等的普遍前提 | host 最终 response 的单个字段已有，当前缺；仅补该选定值及缺失／截断语义，不传整份 headers |
| 采集时间／顺序 | 仅在时间、顺序或当前状态主张依赖它时必要 | 有 SDK 工具起止和 host 注册／收束区间，均不是准确 HTTP 采集时刻，且未进入允许读取链。历史精确时间保持 unknown；本次静态 bytes 主张不新增必填时间，不用 mtime、模型文字或事后时间回填 |
| body 完整性／范围 | 必要来源完整性及精确选区 | 已通过 publication、artifact.read、manifest 和 prepared manifest 交付 `originalComplete/start/end/originalBytes/rangeComplete/snapshotFixed/sha256/size`；复用，不加重复字段。file 副本仍 unknown |

最小绑定与出口：由 host 在最终 body 捕获处把实际 method、去敏目标、status 及必要 Content-Type 与同一次 bytes／complete、callID／resource 关联，沿既有 source 到 publication；既有 ref／hash／范围绑定该 body。Verifier 复用 `package.read(component="manifest")` 或自己准备目录的 manifest 读取，不新增 registry、工具、完整 schema 或 audit 权限，也不必为本切片开放 `artifact.read` 的完整 source。

特别区分初始方法与实际方法：`http-tools.ts` 在 303、或 POST 的 301／302 后切换 GET；现有 redirectChain 没有每 hop method。三条历史记录只有一跳，因此可从 args＋实现核对其方法，但这不是已存储 final-method 的通用接口证明。该离线调查未实现或运行验证多 hop；本轮实现后的本地重定向检查另见 §5.2，不追溯补写旧来源。method／path／200 也不能代替请求参数、认证会话或业务副作用证明；这些仍按具体主张保留缺口。

不传 Cookie、Authorization、Set-Cookie、原始 query／fragment、完整头或秘密路径。当前状态、可重复性、认证来源等不能从旧 body 或新字段自动推出；必要事实未采集或无法可靠绑定时继续 inconclusive。host 记录只证明捕获事实，不证明业务语义或候选权威性。

## 5. 最小验证与完成边界

当前只验证一个能力切片：**原 HTTP artifact 直接入包后，固定 bytes、来源与判定所需事实是否能经既有接口到达 Verifier。** 复用 §1 的原件／副本和现有 package／handoff 检查；不重跑解题、不执行历史包内脚本、不建设新 gate。

- 用同一原始输入比较“原 ref 入包”和“副本入包”，读回 manifest／file／prepare：原件 bytes 与身份不变，副本不能被升格为原 HTTP；真实 12-byte 差异必须保留。
- 逐个必要字段核对原 HTTP 回复 → outputSources → publication → package → Verifier 允许读取路径。源码存在和真实可读分开，缺失就是验证结果，不为了出绿改产品。
- 对照原报告四类 blocker，标明原引用修正能处理哪项、其余还缺什么。原报告不修改，不用清空字段构造“成功样本”。沿用现有截断／unknown、跨题、分页与候选相等不自动通过的检查；没有新受影响分支不追加全矩阵。

完成条件是有界对照与字段去向支持 §4 的一个分支，明确必要的最小接口或无需接口；不是拿到 verified。结论连同基线、条件、命令、失败和剩余未知回写本文。必要最小去敏证据复用 `docs/gates/d-artifact-handoff-20261024/`，不保存候选正文或重复全 run。工程连通、模型正确选材／判断、可信完成分别陈述；真实行为验证需另有模型／provider、目标、批次与 token 预算，不继承 r4 授权。

### 5.1 2026-10-26 本次结果

基线 `fb8f618b6174ea1e9f02adbb8f636f924f92c316`，包含 `b1afa29a`；独立工作树的输入文档 hash 匹配，产品／角色／既有测试 hash 前后未变。Node v26.3.0，实际 Vitest 2.1.9；只读使用已有依赖 symlink。原 run 的 productDirty 来源边界仍保留，不能把当前基线冒作原运行源码。

实际调用 `ArtifactPublisher.publish/read`、`CandidatePackages.publish/read/prepare/checkPrepared`；六个原 ref 映射为新本地 ref，使用明确 offline run／session 身份、execution=null，无 registry 注入或活动原 run 身份冒用。两包保持同一 candidate 范围与三条 evidence path，分别选 HTTP 原件和 file 副本。这里只验证数据接口；原生角色权限／版本规则由既有测试覆盖，不冒称重新采集 HTTP 或真实角色执行。

| 原件／副本大小 | bytes 相等 | 读回／准备 | 来源完整性 |
| --- | --- | --- | --- |
| 26／26 | 是 | 各自精确保持 | 原件 http／true，副本 file／null |
| 6218／6230 | 否，+12 bytes | 差异完整保留 | 同上；不从长度推定所有转码原因 |
| 2638／2638 | 是 | 各自精确保持 | 同上 |

原最终 version／准备目录与三条选中副本的 bytes／hash 对上，准备 manifest 等于原固定包；因此不是 prepare 造成复制损坏。输入前后 hash 未变。最小引用映射、字段去向、原报告摘要和命令结果见[去敏证据摘录](../../gates/d-artifact-handoff-20261024/original-evidence-readability-20261026.json)，不含候选值、原 body 或凭据。

四类 blocker 分别处理：

- `necessary source incomplete or unknown`：三条必要 file 副本的机械来源缺口可由原 ref 入包解决；原 candidate 本已是 HTTP 来源。原报告未修改或重新登记，不能称它已解除。
- `required premise unknown`：总体未解决。当时 status／Content-Type 待 §4 接口补齐（新采集的实现结果见 §5.2）；原报告另有采集／当前状态、不可重连等 unknown，不能追溯补证。
- `unresolved verifier issues`：总体未解决。八条原 issues 中元数据／目标关联只是一部分；单次探测的可重复性、认证来源、独立推导及当前状态限制不会因原引用或元数据而消失。
- `undeclared dependencies unknown`：未解决。最终报告明确 declaredDependenciesOnly=true，依赖仍 unknown。既有 D §6 已允许在显式受信任本地执行前提下讨论条件性判断，不另建 schema，也不一律要求清除全部 unknown；但不能盲改 requirements 或清空报告来通过。

定向命令为三个指定现有文件的 `vitest run`，**只运行一次，42/42 通过，退出码 0**。配置复用仓库原配置，仅把 cacheDir／TMPDIR 定位到本子区 runs、关闭结果缓存，避免写共享依赖；完整命令保存在摘录及短日志索引。未跑全套、typecheck／build、模型、OpenCode、scripted 全链、Docker、目标 HTTP 或原包脚本；真实 usage=`unavailable`。

保留两项调试记录：初次定位 verification-results 用错目录导致只读命令 exit 1，随后在同 run 的 evidence/ 找到；临时驱动最初把 headers 当字符串，错误提取 Content-Type=null，按实际对象结构修正后以同输入重跑，仅修改驱动。首份短输出仍保留，未当作产品失败或字段不存在。临时发布／准备 bytes、测试 tmp 树已删除，只保留驱动、短输出、失败说明与一份去敏摘录。

本离线切片完成时，§3 角色修正与 §4 元数据接口尚未实现（后续见 §5.2），模型选材／语义判断、独立验证通过及可信完成均未新增证明。主助手已核对对照驱动、实际输出、42 项测试结果及产品未变边界，结论与去敏摘录同步回主区；没有重复运行检查。必要驱动、短输出和失败说明保存在主区忽略目录 `runs/d-original-evidence-readability/`，临时 bytes／测试树不保留。结论转入后删除一次性验证 plan，专用工作树随后归档；未 commit／push。

### 5.2 2026-10-26–27 最小实现结果

在专用工作树 `/Users/caihaoming/.codex/worktrees/d-http-evidence-implementation/pentest-agent`，基于确切 HEAD `fb8f618b6174ea1e9f02adbb8f636f924f92c316` 实现同 body capture 的实际 method／status／有界 Content-Type／host scope origin，经本次 callID/resource → 可选 source.http → 既有 publication 快照／manifest／prepare 及静态报告交付；未改 package 实现、verification-results.ts 判定／report schema 或权限。Engineer 未改证据直接引用，Coordinator 交目标／版本／证据／缺口／预算，Verifier 独立选方法与必要条件；必要分析和转换保留。scope 只证明 origin，所有 path=null、pathStatus=omitted_unattested，不能核实具体 endpoint；userinfo/query/fragment 不传值，选定字段缺失、命中 host 已知秘密、超 2048 bytes 分别明确 missing/redacted/omitted_over_limit，不建设秘密识别框架。原 r4 报告及四类 blocker 不宣称已全部解除，历史时间、认证、当前状态、可重复性及实际依赖仍按主张保留缺口。

新增断言先 RED（8 fail），随后五文件定向 82/82，typecheck／build exit 0；全套首败 57 项源于仓库内 TMPDIR 的运行数据隔离约束及无扩展名脚本被 type=module 解释，保留实际 require-is-not-defined 首错；只将 TMPDIR 移到本专用区容器内、仓库外后重跑一次，全套 49 文件、494/494、exit 0，代码未再改。小型输入 hash、配置、退出码和首败／成功日志已保留在主区忽略目录 `runs/d-http-evidence-implementation/`，原可读性 gate 未变，临时数据已清理。

作者自审完成；GPT‑6.1‑sol 独立评审无重要／阻断项，源码与评审快照无 delta。只认定工程交接和无模型检查通过，未调用模型/provider、OpenCode 全链、Docker、原题或历史 run 脚本，usage=unavailable；模型遵循、语义判断、提速及 verified/solved 未新增证明。2026-10-27 主助手核对主区原有 30 份未提交文件均未变，只合入本片 10 份源码／角色／测试及 2 份设计文档；10 份源码／角色／测试 hash 与已测、已评审快照一致，未重复全套测试。未 commit/push。结论已转入本文，一次性 plan 已删除，专用工作树按原生工具归档。

## 6. 本次不做与相关设计

保留版本、同题绑定、发布完整性、独立 Verifier、unknown、副作用与可信完成边界；不扩普通网络权限、不扩同步发布、不恢复生命周期重构、不新增通用 provenance／replay 平台、自动提交／重试或角色，不为通过而削弱报告校验。不把内部验证安排写成固定解题流程。

《空正文恢复》（工作区未提交草案 `2026-10-26-design-v1-c-empty-result-recovery.md`）处理报告未生成，不作为本次离线取证的前置工程；若将来直接阻断局部行为验收，再单独处理具体依赖。《方法与耗时》（工作区未提交草案 `2026-10-26-design-v1-b-method-generalization-and-efficiency.md`）可据已确认的缺口提炼通用方法，不要求整个 D 完成后才分析，也不教模型绕过不可达证据。三者不是固定里程碑。
