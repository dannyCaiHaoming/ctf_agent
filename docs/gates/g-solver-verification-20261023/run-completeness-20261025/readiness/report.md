# readiness §0 无模型核对

日期：2026-10-25 Asia/Tokyo。工作区：`/Users/caihaoming/.codex/worktrees/local-readiness-validation/pentest-agent`；HEAD `cfa950fd7129203f21baceeab399ed9cf675a1c7`，detached，带主区 current snapshot 未提交改动；非 clean commit 基线。本次未修改生产文件，未启动目标/模型、未读取私有 oracle 答案、未 commit/push、未删工作区。依赖复用现有只读 node_modules，Vitest 实际 2.1.9。

## 结论

目前不能选“现成可信 A”：现有部署只见镜像启动和依赖准备，没有证明题目 seed 完成并绑定当前容器/题目版本/私有 judge 的记录。B 需要先澄清本题应部署何种 seed、正确材料版本和非秘密可验证的题目身份，尚不能声称专用只读检查可行。当前最小正确决定是 **readiness unknown；要求 readiness 的真实 run 不准入**。这只是设计建议，现有产品未实现此准入规则。

## 证据层次

1. 历史：readiness design §2.2 转引旧对话“表为空”，本次没有访问 DB，未独立重证空表；旧 H design 固定 digest 也不是 seed 证明。
2. 当前代码：`run-prep.ts:57–89` 收集材料、TCP connect、固定材料与写 challenges evidence；`challenges.ts:20,53–55,64–65` 严格拒绝未知字段。`releaseProfile.ts:28–38` 无 readiness 配置。`launch.ts:159` 在启动 OpenCode 前调用 prepareRun；现有材料 hash 绑定的是输入文件，不是容器或题目实际 seed。
3. 离线行为：仅使用临时 TCP listener，调用真实 prepareRun 接口；未自写 readiness 判定器。`offline-results.json` 是现有接口行为，不是新机制验收。
4. 尚未实现：required/NA 声明、实例/版本证据、seed 完成证明、与 judge 对应性及失效检查。

## 当前准备链

`profile.challenges → loadChallengeList → collect/material hash → TCP connect → read-only material copies + evidence/challenges.json → PreparedChallenge → OpenCode`

throwback Dockerfile 使用 Python 2.7 alpine，ADD CTFd、安装 requirements、CMD python serve.py。compose 直接 image/端口映射；local compose 有 build 和 loopback 8001:4000；无 volumes/entrypoint/seed 命令。CTFd/prepare.sh 仅安装系统依赖和 requirements。serve.py 创建 Flask app 并监听 4000；create_app 调 db.create_all（建表不等于插入本题数据）。未深入模型/题目/私有配置、未查看 DB 内容。

r2 profile 指向主仓 OpenCode example config 与相邻 challenges.json；材料为仓库外 public 目录的 challenge.txt 和 throwback_templates.tar.gz，仅核对路径，未读材料。run-once 静态搜索 Docker/seed/prepare/inspect/image/digest 均无匹配；调用 launch，含 oracle 绑定位置，但本次不读取相关值或私有答案。没有可证明准备过程的记录入口。

只读 Docker ps/inspect 当前观察：container `1deeaf2fb20bfbff5e015877a3eae2dc2b2e4f454a83a9e11ec8c6ec1d58d653`，Image `sha256:ec0deee9a8a45ac74494e7dfc92357711fcf0b1e1c58543f09d6f824f3d9be98`，state `exited`，Created `2026-10-24T14:54:15.841477253Z`，StartedAt `2026-10-24T14:54:15.86797592Z`，FinishedAt `2026-10-24T15:14:59.844888635Z`，Mounts `[]`。这是身份和停止状态，不证明题目存在或镜像所有版本无 seed。

## 逐项矩阵

| 情况 | 现有实现/离线观察 | 可信 readiness 能否成立 / 缺项 |
|---|---|---|
| required 缺 seed | 加 readiness.required 被拒绝 unknown fields；不加则仅看端口 | 不能，尚不能表达 required，也没有 seed 证据 |
| 端口通但无准备证据 | port-only accepted=true, reachable=true | 不能；TCP 不证明 HTTP/业务/seed |
| 实例/版本变化 | 无实例/版本输入，同一旧契约仍 accepted；此例没有真重建容器 | 无法识别变化；需实例 ID+准备版本及失效策略 |
| 有效绑定证据 | 候选 readiness.evidence 字段被拒绝；未虚构真实有效凭据 | 尚未有可验实例；不能宣称 A/B 已通过 |
| not applicable | 无 target 的 statement 输入 accepted, reachability=null | 现有离线材料契约可用；没有显式 NA 语义，不能把缺证据默认当 NA |

## 命令与验证

- `node_modules/.bin/vitest run tests/contract/run-prep.test.ts tests/contract/opencode-config.test.ts`：exit 0；2 files / 15 tests passed，run-prep 13 项内含 challenges/profile 路径解析、缺配置拒绝、本地 closed/listening TCP、材料固定与泄密检查。未运行全套/typecheck/build，未修改代码无需重复全面回归。
- `node_modules/.bin/tsx <本目录>/check.mts`：exit 0；5 行实际接口结果保留于 offline-results.json，临时输入与现有 challenges evidence 保留于同目录。
- `docker ps -a --filter ancestor=llmctf/2015q-web-throwback --format ...` 及白名单 `docker inspect --format`：exit 0；仅身份/状态/挂载，无 env、日志或文件读取。
- 文件 SHA-256 清单：hashes.json。具体源码路径均在清单中，源码行号以该 hash 版本为准。

## A/B 与最小后续范围

A：可复用 Docker instance/image 身份、材料 hash、现有 launch 前 prepareRun 位置；缺可信 seed 记录生产者，不能把增加一个 JSON ready 文件当证明。若采用 A，需要在仓库外可信部署/准备入口产生并绑定记录，launcher 验证当前实例/版本与记录一致。

B：未有可靠现成判据。先确定本题 seed 的预期内容与部署方式；再验证可否在可信 host 边界只读核对题目身份、版本及 judge 对应，不输出答案。DB 表非空或题数不够。

最小确定影响范围：`apps/launcher/src/challenges.ts`（声明）、`run-prep.ts`（准入和 evidence）、现有 `tests/contract/run-prep.test.ts`；若声明从 challenge list 进入，不必改 releaseProfile。外部可信准备脚本位置/所有者仍待定；专用检查是否需要外部部署代码新增，以 A/B 可行性结果决定。目前不宜先改 SDK、plugin、Solver 工具、schema 框架或 oracle 实现。

## 限制与范围偏差

没有访问 HTTP、容器 DB、私有配置、oracle 答案或原始 reasoning；没有重建/启动/exec 容器。无法证明任意攻击路线不可行，也无法证明完整镜像不存在其他 seed 来源。无产品模型调用，模型 usage unavailable。

一次读取目标 README 时，其末尾含 Solution 区域的外部链接标题；未访问链接、未读取解法正文或 flag 值，报告不复制这些链接。后续严格限定部署文件和白名单投影。该偏差已告知主会话。
