# R1：可信准备来源验证

日期：2026-10-25 Asia/Tokyo。结论：**readiness 仍 unknown；R1 是整份 design 定稿的 blocker。** 未发现可选择 A 的可信准备记录，也没有足够依据确定 B 的题目专用非秘密判据；不能借标 unknown 宣告整份设计定稿，不代用户排除 Throwback。

## 输入与边界

独占工作区 `/Users/caihaoming/.codex/worktrees/readiness-source-validation/pentest-agent`，HEAD `81cc7fc06497088d9391c9ed93cc405694f6cf2e`，包含继承的 dirty snapshot；不是 clean HEAD 验证。适用 AGENTS/CLAUDE、R1 plan 与当前 detailed design 的 hash 均匹配 `input-hashes.json`。完整读取对象路径/hash 见 `read-hashes.json`；源快照见既有 `baseline/`。仓库文件未改，未 commit/push。

先按旧 readiness/report.md 和 hashes.json 确立部署文件白名单：Dockerfile、两份 compose、CTFd/prepare.sh、serve.py、CTFd/__init__.py。仅列目录与文件名后，新增白名单 CTFd/populate.py；该文件只经 Python tokenize 提取 import/call 标识符结构，未输出字符串、数值、注释、调用参数或源行。未读取 README、challenge.json、模板附件、DB、私有配置、私有 oracle、答案或解法正文。未运行目标、HTTP、Docker、模型或 provider；usage unavailable。

历史 local-practice design 在当前工作区不存在；以旧 readiness 报告已指明的历史 worktree 同名文件只读核对相关准备段，不把历史文件视作当前权威。其 hash 单独保存。

## 已证实的结构观察

- Dockerfile 将 CTFd 目录放入镜像、安装依赖，CMD 运行 serve.py；compose 仅镜像/构建、端口和网络声明，无 seed entrypoint 或可信准备记录生产配置。prepare.sh 只安装依赖。
- serve.py 调 create_app 后启动服务；CTFd/__init__.py 白名单初始化路径含 create_all，没有调用 populate.py。建表不是题目 seed 完成证据。
- 新发现的 CTFd/populate.py 确实存在，hash `6588cf507360196dd8a83ed7766abcd43cc2b4dd6dd104860d99319ea2bba9e7`。标识符结构含随机生成、CTFd 数据模型构造和 commit；这仅支持“存在数据生成脚本”，不能确认预期题目 seed、实际运行、运行成功、其与外层 Throwback 身份或 judge 的关系。没有执行该脚本，没有用它制造 ready 样本。
- CTFd 目录候选准备文件名盘点只识别 prepare.sh 与 populate.py；没有发现同树已命名的 seed/entrypoint/migration 准备契约。该结论限于白名单与路径盘点，不证明完整镜像、隐藏外部流程或所有版本都没有 seed。
- 历史 local-practice design §2.1 只固定镜像 digest，并明确 Throwback 尚无已核对 controller-side oracle；§7 仍要求另行确定容器重置方式。它不提供 seed manifest、可信准备记录或当前 judge 绑定。未访问 oracle 补证。
- 旧 readiness 报告已核对外部 run-once 无准备入口；本轮不重读其含 oracle 绑定位置的内容，也不重复 TCP/旧矩阵。旧容器 ID、image、stopped 状态仅作为历史观察，不声称当前实例。

## 可以定稿的行为边界

1. required 与 not applicable 必须有显式语义；缺证据不能默认 NA。
2. 要求 readiness 而来源/版本/当前实例绑定不足时为 unknown，可信准备流程应阻止模型 run；当前产品没有自动 guard，不能写成已实现拒绝。
3. 准备失败不自动部署/修 seed；实例重建、重置、材料或准备版本改变不得复用旧 ready。具体失效标识仍需来源契约决定，不能只凭 image digest（重置可不改 image）。
4. 只交给模型非秘密 readiness 事实与必要理由，judge 私有答案及控制凭据留在可信边界。

以上可定的是安全准入/失败原则，不能替代成功 ready 的生产者、判据或验收样本。

## 精确缺输入与责任边界

| 必需输入 | 现有位置/缺口 | 责任方与用途 |
| --- | --- | --- |
| Throwback 预期 seed 的权威来源与版本 | `.../web-validation/targets/throwback/` 启动链未声明；populate.py 仅有生成结构 | 靶场/部署维护方提供认可的准备入口或非秘密 manifest，明确其是否应运行、对应外层题目/材料版本；无需提供数据正文或答案 |
| 可验证的准备成功语义与记录生产者 | 同目录未找到可信记录输出约定；无成功记录可绑定当前实例 | 可信部署控制方确定记录位置、生产动作、成功/失败条件及可信读取边界；不能让 Solver 写 ready 文件自证 |
| 非秘密身份关联 | 历史镜像 digest 和材料 hash 各自存在，但没有题目 seed→材料→judge 关系 | 部署/题目维护方提供公开 challenge/revision/seed identity 与材料 hash 的关系；judge 接入维护方提供公开 judge identity/version 或明确 NA 依据，禁止私有答案 |
| 实例与 reset 失效标识 | 当前没有实例 generation/准备 epoch 的契约；旧 ID 不代表现在 | 部署控制方明确重建/重置时可信更新的实例/epoch 读取入口以及旧记录何时失效 |
| B 的非秘密检查预期 | 无权威 seed manifest，不能从随机数据或表非空推导 | 题目维护方定义能够区分正确准备与空/错版本/错题的非秘密检查指标，可信 host 实现与核验，不向模型开放 DB/Docker |
| required/NA 适用声明 | 现有 challenge schema 无显式语义；不能用当前未支持当作排除依据 | 设计负责人基于题目维护方契约确认需要哪些检查，NA 要有明确理由 |

路径中的 `...` 固定指 `/Users/caihaoming/Documents/pentest-agent-run-data`。这是待提供材料的定位建议，不虚构已有新文件或新的框架职责。

## A/B 与整体定稿影响

A 仍未成立：有 Docker/image/material 可复用身份信息，但没有可信 seed 完成记录生产者及绑定契约。B 仍未成立：populate.py 的存在不足以定义该题就绪判据，且不能用 DB 非空/题数替代版本和正确题目对应。故不进行纯本地凭据样例；此时演示只能证明自行发明的格式，不能回答 R1。

推荐保持 R1 blocker，向部署/题目/judge 接入维护方索取上述非秘密契约。若这些材料实际不存在，需要由用户决定是否另行授权建立准备来源，或明确延期/排除这项目标。排除 readiness 会失去本设计在未知 seed 上阻止继续消耗预算的目标，也无法覆盖原 Throwback 调试失败条件；R2/R3 即使通过仍不能据此宣称整份设计完整定稿。

## 命令、失败与验证限制

执行的均为静态只读检查：pwd/git status/rev-parse、cat 指定指令/design/plan/旧报告、部署白名单文件读取、rg 指定初始化与文档准备段、find 文件/目录名、Python tokenize 安全投影及 SHA-256。初次读取当前工作区 historical local-practice design 返回 No such file；随后按旧报告路径核对历史副本，已分层记录，不创建替代文件。无源代码变更，未跑测试/typecheck/build；没有真实 readiness 成功样本、实例重建验证、模型语义或真实目标验证。审计输出仅本目录 report.md/read-hashes.json，未接入主区。
