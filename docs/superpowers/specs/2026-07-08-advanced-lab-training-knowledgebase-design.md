# 高难度靶场训练与知识库引入设计

## 背景

当前 Agent 已经通过 Juice-Shop 做过多轮调试，并沉淀了浏览器探索、API 覆盖、source-sink、运行时日志、断点继续和半自动认证等基础能力。下一阶段不应继续使用入门靶场训练，否则容易让 Agent 的策略停留在单点漏洞和固定题目答案层面。

本设计把 Juice-Shop 作为历史基线，不纳入本轮三靶场训练目标。本轮只选择整体难度、推理复杂度或技术形态高于 Juice-Shop 的训练目标，并把训练结果蒸馏成通用 Agent/Skill 能力。

## 目标

1. 搜集并登记三个高于 Juice-Shop 难度的靶场。
2. 为每个靶场建立训练 profile、scope、训练目标、风险边界和预期能力覆盖。
3. 每次训练后输出结构化结果：完成情况、失败原因、覆盖缺口、Agent 问题、Skill 改进候选、知识库引用。
4. 把做题经验蒸馏为通用 skill 或 knowledge rule，禁止变成靶场专用解法。
5. 引入方法论知识库，参考 `refer_project` 的分析方式，让知识库参与策略规划、报告映射和漏报反馈。

## 非目标

- 不在本轮直接下载、启动或攻击外部未授权目标。
- 不把 PortSwigger 在线实验室的具体答案、payload 或账号状态写入项目。
- 不新增靶场专用 exploit runner。
- 不把知识库做成大段不可检索的长文档。
- 不把 Juice-Shop 删除或替换；它仍作为回归基线。

## 靶场选择

### 1. OWASP crAPI

来源：[OWASP crAPI](https://owasp.org/www-project-crapi/)

定位：高难度 API 与微服务训练目标。

训练重点：

- Broken Object Level Authorization。
- Broken Function Level Authorization。
- Mass Assignment。
- SSRF。
- NoSQL/查询语义问题。
- 多步骤业务 API 链路。
- 多角色、多对象、多状态差分。

对 Agent 的提升：

- 强化 API-first recon。
- 强化对象级授权矩阵。
- 强化 role/resource/state 三维覆盖。
- 强化从 API 文档、前端请求、runtime capture 到验证队列的映射。

### 2. DVGA Expert Mode

来源：[Damn Vulnerable GraphQL Application](https://github.com/dolevf/Damn-Vulnerable-GraphQL-Application)

定位：GraphQL 专项高难度训练目标。

训练重点：

- GraphQL introspection 与 schema recon。
- Query/mutation/subscription 攻击面。
- GraphQL JWT 与鉴权绕过。
- Deny-list bypass。
- 嵌套查询、批量查询和复杂度风险。
- GraphQL 错误信息与类型系统推理。

对 Agent 的提升：

- 增加 GraphQL schema-first recon。
- 增加 GraphQL object authorization 分析。
- 增加 query cost、depth、batching、alias、fragment 的安全检测模式。
- 增加 GraphQL 与 REST API 覆盖矩阵的统一抽象。

### 3. PortSwigger Web Security Academy Advanced/Expert/Mystery Labs

来源：[PortSwigger Web Security Academy Labs](https://portswigger.net/web-security/all-labs)

定位：专家级黑盒推理训练目标。

训练重点：

- Advanced、Expert、Mystery 难度实验。
- 隐藏题型与弱提示条件下的假设构建。
- 多漏洞类别组合推理。
- 复杂业务逻辑。
- 浏览器行为、HTTP 差分、缓存、请求走私、模板注入、认证状态等多类线索。

对 Agent 的提升：

- 强化黑盒假设管理。
- 强化 evidence-first 的多轮验证。
- 强化失败后回到线索源重新规划。
- 强化报告中 candidate、checked、verified、blocked 的区分。

## 知识库选择

### OWASP WSTG

来源：[OWASP Web Security Testing Guide](https://owasp.org/www-project-web-security-testing-guide/)

用途：

- 提供 Web 测试场景分类。
- 为训练任务绑定测试编号、检测意图和证据要求。
- 帮助报告把发现映射到测试方法。

### OWASP ASVS

来源：[OWASP ASVS](https://owasp.org/www-project-application-security-verification-standard/)

用途：

- 提供控制项和验证标准。
- 帮助将 findings 映射到认证、会话、访问控制、输入验证、API、安全配置等控制域。
- 帮助生成测试人员漏报反馈。

### OWASP API Security Top 10 2023

来源：[OWASP API Security Top 10 2023](https://owasp.org/API-Security/editions/2023/en/0x00-header/)

用途：

- 作为 crAPI 和真实 API 项目的风险分类主轴。
- 帮助 strategy planner 在 API-heavy 项目中提高 BOLA、BFLA、Mass Assignment、SSRF、Unrestricted Resource Consumption 的权重。

### CWE Top 25

来源：[CWE Top 25](https://cwe.mitre.org/top25/)

用途：

- 把漏洞现象映射到弱点根因。
- 支撑报告修复建议和复测标准。
- 支撑知识库中的 root-cause 归纳。

## 架构设计

新增训练与知识库能力保持文件化，不引入数据库。

```text
pentest-agent-harness/
  labs/
    catalog.json
    crapi/
      lab_profile.json
      scope.json
      expected_capabilities.json
    dvga/
      lab_profile.json
      scope.json
      expected_capabilities.json
    portswigger-academy/
      lab_profile.json
      scope.json
      expected_capabilities.json
  knowledge/
    sources/
      owasp-wstg.json
      owasp-asvs.json
      owasp-api-top10-2023.json
      cwe-top25.json
    training_lessons.json
    skill_improvement_backlog.json
  tools/
    build_training_plan.py
    record_training_outcome.py
    distill_training_lessons.py
  skills/
    lab-training-loop/
    knowledge-grounded-strategy/
    graphql-security-recon/
    api-object-authorization-analysis/
    lesson-to-skill-distillation/
```

## 数据流

1. `build_training_plan.py` 读取 `labs/catalog.json`、单个 lab profile、知识库 sources 和当前 Agent 能力。
2. 工具输出 `artifacts/training-agent/training_plan.json`，包含本轮训练目标、知识库映射、候选 skills、禁止项和成功标准。
3. Agent 根据训练计划执行授权靶场测试，过程继续使用 `events.jsonl`、`progress.json`、`api_coverage_matrix.json`、`test_trace_ledger.json`。
4. `record_training_outcome.py` 记录训练结果，不记录靶场专用答案，只记录能力缺口、证据类型、失败模式和可泛化经验。
5. `distill_training_lessons.py` 把训练结果转成：
   - `knowledge/training_lessons.json`
   - `knowledge/skill_improvement_backlog.json`
   - skill 文档补丁建议
   - regression case 候选
6. Evaluation Agent 判断哪些 lesson 可以进入通用 skill，哪些只能保留为靶场训练记录。

## 反靶场绑定规则

训练经验进入 Skill 前必须通过泛化检查：

1. Skill 不得出现具体靶场题目名、最终答案、固定 challenge endpoint、固定 flag、固定 token。
2. Skill 必须描述适用场景、输入信号、检测步骤、证据要求、失败模式和 R2 补测规则。
3. 如果经验只能用于一个靶场，则只能留在 `training_outcome`，不能进入通用 skill。
4. 如果经验来自某个靶场，但可迁移到真实项目，必须改写成通用 pattern。
5. 所有 payload 必须按风险分级：read-only、low-risk validation、confirmation-required、forbidden。

## Agent/Skill 改进方向

### `lab-training-loop`

职责：

- 读取训练计划。
- 控制每轮训练的范围、目标和安全边界。
- 记录训练产物路径。
- 把失败原因交给蒸馏工具。

### `knowledge-grounded-strategy`

职责：

- 根据 WSTG、ASVS、API Top 10、CWE 和 lab profile 调整测试优先级。
- 输出知识库引用、测试假设和证据标准。
- 避免只靠历史靶场经验做题。

### `graphql-security-recon`

职责：

- 识别 GraphQL endpoint、schema、operation、type、field、resolver 线索。
- 生成 GraphQL API inventory。
- 建模 GraphQL 对象级授权和查询复杂度风险。

### `api-object-authorization-analysis`

职责：

- 统一 REST、GraphQL、微服务 API 的对象级权限测试。
- 生成 role/resource/action/state 矩阵。
- 记录 BOLA/BFLA/Mass Assignment 的验证证据。

### `lesson-to-skill-distillation`

职责：

- 把训练结果改写成通用 skill 候选。
- 拒绝靶场专用答案。
- 输出 skill patch 建议和回归用例候选。

## 成功标准

1. 三个高难度靶场被登记到 catalog，并包含训练目标、风险边界和知识库映射。
2. 知识库 sources 能被训练计划引用。
3. 每轮训练结果能输出结构化 outcome。
4. outcome 能被蒸馏成通用 lesson 和 skill improvement backlog。
5. 新增或修改的 skill 通过 `check_agent_skill_docs.py`。
6. 全量测试通过。

## 测试策略

- 单元测试 `labs/catalog.json` 的难度和字段完整性，确保不包含入门靶场。
- 单元测试 knowledge sources 必须包含来源 URL、版本、适用能力和映射类别。
- 单元测试训练计划能把 crAPI 映射到 API Top 10，把 DVGA 映射到 GraphQL skill，把 PortSwigger 映射到黑盒假设管理。
- 单元测试 outcome 蒸馏时拒绝靶场专用题名、flag、固定答案和固定 endpoint。
- 单元测试通用 lesson 能进入 skill backlog，并保留 source lab、source evidence 和泛化理由。

## 参考项目迁移

本设计继续沿用 `refer_project` 的迁移结论：

- 参考 `code-audit-main`：训练结果必须进入覆盖矩阵和多轮补漏。
- 参考 `security-skill-distiller-master`：经验必须蒸馏为项目可复用 skill，而不是一次性报告。
- 参考 `Shannon`：训练中的候选发现必须进入验证队列，报告只接受有证据的 verified 项。
- 参考 `Strix`：训练过程必须保留 agent graph、事件日志、工具调用和完成门禁。

## 风险与边界

- PortSwigger 在线实验室需要用户自行提供授权账号和目标 URL，本项目只登记训练 profile 和通用方法，不保存账号。
- 高难度靶场可能包含破坏性类别，例如 DoS、RCE、SSRF 外联。默认进入 `confirmation-required` 或 `forbidden`，不得自动执行。
- 训练过程失败是有效产物，必须记录失败模式和下一轮改进点。
- 知识库版本可能更新，sources 必须保留 `source_url`、`retrieved_at` 和 `version_hint`。
