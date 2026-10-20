# M1b 轨迹② T2-C 正式验收结果

日期：2026-10-20（Asia/Tokyo）  
批次：`m1b-opencode-t2-bailian-20261020-b1`  
状态：**正式验收 3/3 通过；轨迹②达到 2/3 门槛。** M1b 其余轨迹③–⑥未启动。

## 准入、模型与批次冻结

- 用户授权：预检和最多 3 次独立正式 run；不 commit、不 push。
- 百炼标准 API `https://dashscope.aliyuncs.com/compatible-mode/v1`：认证 `/models` HTTP 200，目标模型 `deepseek-v4-flash-0731` 可见。
- 受限 OpenCode 可用性探针：成功返回预期标记；550 reported tokens（421 input、11 output、118 reasoning），无题目材料，单独计为预检，不计 solver attempt。
- 精确余额/剩余额度、探针金额费用：`unavailable`。API key 工作流没有账户余额查询；`engine_cost=0` 不作为实际金额或免费调用证据。
- 固定模型：`bailian/deepseek-v4-flash-0731`，Bailian standard API，temperature 0.2；OpenCode 1.19.3。
- 固定预算：每次 600,000 ms、40 steps、20 tool jobs、100,000 observable tokens。Reference 关闭、无 preset、无人工介入。材料限于 `target.mjs`、`decode.mjs`、`payload.txt`。
- 完整配置、生产/测试/fixture/grader/runtime 哈希与冻结身份见 [manifest.json](manifest.json)。预检、材料、每次 attempt、逐 run 结果及完整证据归档均保留在本目录。

## 独立正式运行

| Run | Run / Challenge / Session | 判分 | 实际墙钟 / steps / jobs / observable tokens | 模型调用与 provider usage | 证据包 SHA-256 |
| --- | --- | --- | --- | --- | --- |
| 01 | `run_64882c9a-2331-41aa-8665-edc87ae67bf5` / `challenge_5d76e27a-bd79-4a51-a2c6-30544df666ca` / `ses_ea930b649ffe34hHybmUje2O3O` | 通过；oracle accepted + 独立 replay | 42.5 s / 27 / 6 / 50,292 | 9 calls；46,846 input + 3,446 output | `d9b5d75edba38c77e4d3d0b9f8e37007986b759237964945503ac21c245867cd` |
| 02 | `run_aa1a9d5a-4c08-44c6-b48b-2a91065b9b8f` / `challenge_b9bdeb84-a8ef-4f9a-99aa-9684f148603b` / `ses_ea90b0a2dffeherZq58Z9FVaZb` | 通过；oracle accepted + 独立 replay | 50.3 s / 23 / 4 / 47,369 | 8 calls；43,296 input + 4,073 output | `9c131cb2a6bb2cc7076dd801e224327569bf78ac0576df662dad0ba44c8a4155` |
| 03 | `run_4f5fbf5e-6176-4a14-a5f3-ffbad12eb1bd` / `challenge_924e55d8-65a7-4e17-8592-a7b3052b7c2c` / `ses_ea90a07d8ffen0PXyrFhCqQ4C3` | 通过；oracle accepted + 独立 replay | 71.3 s / 35 / 4 / 78,112 | 11 calls；72,958 input + 5,154 output | `002db46074ba22e310487c3806f5acc78ee99a81d16f253355a3e79a7aae8830` |

三次均由真实 OpenCode session 调用指定 provider/model，使用各自 run/challenge/session 和新 workspace。各次 canonical grader 的 artifact、配置绑定、反证/换路、成功输出、独立验证与 authoritative local oracle 检查均通过。共 28 次正式模型调用，163,100 input + 12,673 output = 175,773 observed tokens。失败/异常观察均保留在对应 evidence archive；harness 未重试或替换 run。控制凭证扫描匹配数均为 0，OpenCode 私有 engine state 未打包。

原始 stdout/stderr、SQLite canonical state、artifacts、workspace 与命令记录按次打包为 `run-01-evidence.tar.gz`、`run-02-evidence.tar.gz`、`run-03-evidence.tar.gz`。各包的 SHA-256 见上表；批次目录下独立 `result-0N.json` 保留判分明细、数据库哈希和 usage。

## 语义复核

逐次检查 canonical event 顺序和实际模型提出的理由，完整记录见 [semantic-review.json](semantic-review.json)。三次均出现：提出表达式求值假设及 falsifier → 执行 `node target.mjs "1+1"` → 原始 literal 输出送达模型 → 以该输出登记 `rejected` → 引用反证切换到 base64 decode 机制 → 执行 `node decode.mjs` → 将新路线 stdout 送达模型并注册候选 → 独立 replay 与 oracle accepted。没有把最终 flag 或 accepted 倒推成反证证据，也没有 host 替模型选择路线。

限制：三次均在正式 probe 前读取了所提供的源文件；`target.mjs` 注释和 `decode.mjs` 实现揭示了机制线索。因此这些结果证明模型沿规定证据链验证和换路，不是无材料线索的盲测。判据未据此放宽；候选必须来自实际新路线执行并通过独立 replay/oracle。

## 停止与范围

- 本批冻结授权 3 次，实际正式 attempt 3/3；轨迹②累计 3/12。三次后立即停止，没有第 4 次 attempt，也不把预检算作 solver attempt。
- 12 次为轨迹②绝对停止上限，不扩限、不重置。run runner 在每次启动前核验 manifest 并依据 attempt 文件计数；本批三次授权已先行耗尽。
- M1 轨迹①批次和历史 M1 记录未改写、未混并。③–⑥、TSecBench、VPN、Docker 和多题调度均未纳入。
- 本轮只更新轨迹② gate/plan 结果；未 commit、未 push。既有工作区无关修改保持原样。
