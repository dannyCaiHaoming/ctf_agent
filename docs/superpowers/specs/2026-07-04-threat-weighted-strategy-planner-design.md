# Threat-Weighted Strategy Planner 设计

## 背景

当前 MVP 已具备以下能力：

1. `recon-agent` 能产出攻击面、信任边界、数据流、权限矩阵、source/sink/control seed、威胁模型和侦查优先队列。
2. `browser-pentest-agent` 能接收动态测试输入，并输出浏览器工作流、认证验证、运行时 API、动态证据和 blocked root cause。
3. `evaluation-agent` 和 `debug-agent` 能比较多 Agent 输出，识别 missed、blocked、false positive，并生成下一轮优化信号。
4. `dispatcher-agent` 当前通过 `build_agent_contracts.py` 读取 `recon_priority_queue.json` 和 `threat_model.json`，按目标 Agent 粗粒度生成 R1/R2 contracts。

缺口在于：侦查产物到渗透测试任务之间缺少一个明确的“策略规划层”。现有流程可以枚举威胁，也可以执行测试，但还不能系统回答：

- 为什么这个入口先测？
- 该威胁应该交给哪个 Agent？
- 应该使用哪些 Skills？
- 需要什么角色、资源、请求、源码或浏览器证据？
- 遇到账号缺失、资源 ID 缺失、scope 限制时如何 blocked？
- recon 威胁模型质量不足时，如何回流给 recon-agent，而不是让动态测试层盲猜？

本设计新增 `strategy-planner-agent`，采用 **威胁分析 60% + 规则映射 40%** 的混合策略评分模型。威胁分析决定“为什么测”，规则映射负责“常见安全测试不漏掉”。

## 目标

1. 新增 `strategy-planner-agent`，位于 `recon-agent` 之后、`dispatcher-agent` 之前。
2. 从 recon 产物生成 `pentest_strategy_queue.json`，作为后续 Agent 的细粒度渗透测试任务队列。
3. 从同一批输入生成 `attack_hypotheses.json`，保留攻击假设图谱雏形，为后续攻击链推理升级留接口。
4. 生成 `strategy_coverage.json`，记录无法生成有效任务的原因，并把 recon 质量缺口回流给 `recon-agent`。
5. 每个测试任务都包含 `threat_score`、`rule_score`、`attention_score` 和 priority。
6. 每个测试任务都明确 target agent、skills、目标入口、威胁依据、规则依据、证据要求、安全限制、停止条件和 blocked root causes。
7. 第一版采用确定性规则和可测试评分，不依赖不可解释的模型推理。
8. 不绑定任何靶场、项目、固定 URL、固定 API 或固定账号。

## 非目标

- 不直接执行浏览器操作、API replay、fuzz、PoC 或 payload。
- 不替代 `recon-agent` 生成威胁模型；威胁模型不足时输出 recon gap。
- 不替代 `evaluation-agent` 判断 finding 是否成立。
- 不在第一版实现完整攻击链图算法；只输出可演进的攻击假设结构。
- 不引入数据库、消息队列、复杂调度器或外部服务。
- 不把缺少证据的威胁强行升级成高优先级任务。

## 架构位置

```text
target inputs / source / docs / accounts
  -> recon-agent
  -> artifacts/recon-agent/*
  -> strategy-planner-agent
  -> artifacts/strategy-planner-agent/pentest_strategy_queue.json
  -> artifacts/strategy-planner-agent/attack_hypotheses.json
  -> artifacts/strategy-planner-agent/strategy_coverage.json
  -> dispatcher-agent
  -> agent_contracts / work_queue
  -> static-audit-agent / frontend-audit-agent / browser-pentest-agent / playwright-poc-agent
  -> evaluation-agent
  -> debug-agent
```

`strategy-planner-agent` 只拥有：

```text
runs/<run_id>/artifacts/strategy-planner-agent/
runs/<run_id>/checkpoints/strategy-planner-agent.json
```

它不得写入其他 Agent 的 artifacts、findings 或 checkpoints。

## 输入

必需输入：

- `scope.json`
- `artifacts/recon-agent/threat_model.json`
- `artifacts/recon-agent/attack_surface_boundaries.json`
- `artifacts/recon-agent/trust_boundaries.json`
- `artifacts/recon-agent/auth_matrix.json`
- `artifacts/recon-agent/source_sink_seed.json`
- `artifacts/recon-agent/high_risk_assets.json`
- `artifacts/recon-agent/entrypoints.json`
- `artifacts/recon-agent/api_inventory.json`

可选输入：

- `artifacts/recon-agent/frontend_routes.json`
- `artifacts/recon-agent/api_client_map.json`
- `artifacts/browser-pentest-agent/browser_workflow_inventory.json`
- `artifacts/browser-pentest-agent/runtime_api_observations.json`
- `knowledge/missed_findings.md`
- `knowledge/regression_cases.json`
- 测试人员反馈或历史靶场 debug 产物

## 输出

### pentest_strategy_queue.json

面向 dispatcher 和后续测试 Agent。每个 item 是一个可执行的测试任务，不是 finding。

```json
{
  "round": "R1",
  "strategy": "threat-weighted",
  "weights": {
    "threat": 0.6,
    "rule": 0.4
  },
  "items": [
    {
      "task_id": "PT-R1-001",
      "round": "R1",
      "target_agent": "browser-pentest-agent",
      "skills": ["authorization-control", "safe-replay"],
      "source_threat_ids": ["TH-003"],
      "source_rule_ids": ["RULE-IDOR-RESOURCE-ID"],
      "target": {
        "entrypoint_id": "EP-ORDER-GET",
        "path_or_route": "/api/orders/{id}",
        "method": "GET",
        "asset": "order"
      },
      "threat_score": 86,
      "rule_score": 78,
      "attention_score": 82.8,
      "priority": "P0",
      "hypothesis_id": "HYP-001",
      "hypothesis": "普通用户可能通过资源 ID 访问其他用户订单。",
      "why_this_matters": "该入口跨越用户到后端 API 的资源归属边界，影响订单数据。",
      "required_roles": ["owner", "other_user"],
      "required_evidence": [
        "两个角色",
        "资源归属 ID",
        "请求/响应状态",
        "后端授权控制点"
      ],
      "safety_limits": [
        "不修改订单状态",
        "只读取授权范围内测试数据"
      ],
      "stop_conditions": [
        "账号缺失",
        "资源 ID 未发现",
        "scope 不允许访问该路径"
      ],
      "blocked_root_causes": [
        "browser.account_missing",
        "browser.resource_id_missing",
        "scope.path_not_allowed"
      ]
    }
  ],
  "summary": {
    "total": 1,
    "p0": 1,
    "p1": 0,
    "p2": 0,
    "p3": 0,
    "recon_gaps": 0
  }
}
```

### attack_hypotheses.json

面向 evaluation、report 和未来攻击链推理。第一版只记录假设，不把假设当 confirmed finding。

```json
{
  "hypotheses": [
    {
      "hypothesis_id": "HYP-001",
      "status": "planned",
      "source_threat_ids": ["TH-003"],
      "source_rule_ids": ["RULE-IDOR-RESOURCE-ID"],
      "entrypoints": ["EP-ORDER-GET"],
      "assets": ["order"],
      "trust_boundaries": ["TB-BROWSER-API"],
      "attacker": "authenticated_user",
      "possible_weaknesses": ["IDOR", "missing ownership check"],
      "required_evidence": [
        "两个角色",
        "资源归属 ID",
        "后端授权控制点"
      ],
      "linked_strategy_tasks": ["PT-R1-001"]
    }
  ]
}
```

### strategy_coverage.json

面向 recon 回流和 debug 归因。

```json
{
  "status": "partial",
  "checked_threats": 8,
  "planned_tasks": 6,
  "gaps": [
    {
      "gap_id": "STRAT-GAP-001",
      "type": "threat_model_missing_boundary",
      "required_by": "authorization-control",
      "source_threat_id": "TH-004",
      "message": "威胁项缺少 boundary_id，无法判断权限边界。",
      "send_back_to": "recon-agent",
      "recommended_recon_fix": "为该威胁补充 trust boundary、asset、entrypoint 和 auth context。"
    }
  ]
}
```

## 评分模型

### 总分

```text
attention_score = threat_score * 0.6 + rule_score * 0.4
```

分值范围为 0 到 100。priority 由 `attention_score` 映射：

- `P0`：80-100
- `P1`：60-79
- `P2`：40-59
- `P3`：0-39

### threat_score

`threat_score` 只来自威胁模型及其证据完整度：

| 因子 | 分值 |
|---|---:|
| threat priority 为 Critical/P0 | +25 |
| threat priority 为 High/P1 | +20 |
| 涉及 high risk asset | +20 |
| 涉及认证、授权、租户、资源归属、后台、资金、文件、导出 | +15 |
| 跨越敏感 trust boundary | +15 |
| threat 有 entrypoint、boundary、asset、attacker、evidence | +15 |
| 命中历史漏报模式 | +10 |
| 缺少关键字段 | 每缺一项 -10 |

缺少 `entrypoint_id`、`asset`、`boundary_id` 中任意两项时，不生成高优先级测试任务，转为 `strategy_coverage.gaps`。

### rule_score

`rule_score` 来自确定性规则映射：

| 因子 | 分值 |
|---|---:|
| 高危入口类型：login、upload、export、admin、webhook、payment、file、search | +20 |
| 有用户可控 source | +15 |
| 有危险 sink | +20 |
| 有明确 control point 缺口或未知 | +20 |
| auth_matrix 显示角色、租户、资源归属验证缺口 | +20 |
| 前端 API client 找到调用但后端控制点未知 | +15 |
| 浏览器 workflow 已观察到入口 | +10 |
| mutation 不在 allowed scope | -30 |
| 目标 host/path 不在 scope | 直接 blocked，不生成执行任务 |

规则映射不允许越权扩大 scope；只能在授权边界内生成任务。

## STRIDE 与 Skill 映射

| STRIDE | 典型信号 | target_agent | skills |
|---|---|---|---|
| Spoofing | 登录、会话、token、OAuth、服务账号 | `browser-pentest-agent` / `static-audit-agent` | `auth-validation`、`auth-session-testing`、`control-driven-audit` |
| Tampering | 参数、金额、状态、资源 ID、租户 ID | `browser-pentest-agent` / `static-audit-agent` | `authorization-control`、`safe-replay`、`api-fuzzing-light`、`control-driven-audit` |
| Repudiation | 关键操作、审计日志缺失 | `static-audit-agent` | `control-driven-audit`、`finding-verification` |
| Information Disclosure | 公开资产、API 响应、错误栈、配置、token | `recon-agent` / `browser-pentest-agent` / `frontend-audit-agent` | `recon-enumeration`、`browser-workflow-recon`、`runtime-api-capture`、`api-client-correlation` |
| Denial of Service | 高成本查询、导出、文件解析、批处理 | `static-audit-agent` | `config-driven-audit`、`api-fuzzing-light` 的安全限速模式 |
| Elevation of Privilege | 管理后台、角色边界、租户边界、权限提升 | `browser-pentest-agent` / `static-audit-agent` | `authorization-control`、`auth-session-testing`、`control-driven-audit` |

如果同一任务命中多个 STRIDE 类别，保留主类别，并在 `secondary_threat_categories` 中记录其余类别。

## 规则映射表

| 规则 ID | 输入信号 | 输出任务倾向 | Skills |
|---|---|---|---|
| `RULE-AUTH-LOGIN` | login/session/token 入口 | 登录、退出、会话固定、旧 token、CSRF 观察 | `auth-validation`、`auth-session-testing` |
| `RULE-IDOR-RESOURCE-ID` | path/body/query 中有资源 ID，且 auth_matrix 有 owner/actor | IDOR、资源归属、跨用户读取 | `authorization-control`、`safe-replay` |
| `RULE-TENANT-BOUNDARY` | tenant/org/project 字段或租户边界 | 跨租户访问、租户过滤缺失 | `authorization-control`、`control-driven-audit` |
| `RULE-INJECTION-SOURCE-SINK` | source 到 SQL/command/template/file sink | 注入验证与控制点审计 | `taint-analysis`、`sink-driven-audit`、`api-fuzzing-light` |
| `RULE-XSS-DOM` | URL/hash/API response 到 DOM sink | DOM/reflected XSS 动态验证 | `frontend-runtime-test`、`browser-workflow-recon` |
| `RULE-REDIRECT` | redirect/url/next/returnUrl 参数 | 开放重定向验证 | `browser-workflow-recon`、`safe-replay` |
| `RULE-FILE-HANDLING` | upload/download/import/export/file parser | 文件类型、路径、解析器、安全下载 | 后续新增 `file-handling-security`，第一版使用 `safe-replay` 和 `control-driven-audit` |
| `RULE-API-CLIENT-NO-CONTROL` | 前端 API client 有调用，后端控制点未知 | 前后端授权关联检查 | `api-client-correlation`、`authorization-control` |
| `RULE-PUBLIC-ASSET` | 公开文件、source map、配置、错误栈 | 敏感信息暴露侦查 | `recon-enumeration`、`frontend-recon` |

规则映射只产生任务候选。最终 priority 仍由 60/40 混合评分决定。

## 任务生成流程

1. 读取 `scope.json`，建立 allowed host/path、forbidden actions、mutation policy。
2. 读取 `threat_model.json`，按 threat id 建立主索引。
3. 对每条 threat 检查 `entrypoint_id`、`boundary_id`、`asset`、`attacker`、`priority`、`evidence`。
4. 缺少关键字段时写入 `strategy_coverage.gaps`。
5. 能定位 entrypoint 的 threat，读取 attack surface、entrypoints、API inventory、frontend routes 和 browser workflow 补目标信息。
6. 能定位 boundary 的 threat，读取 trust boundaries 和 auth matrix 补角色、资源归属、租户、认证上下文。
7. 读取 source_sink_seed，为 threat 匹配 source/sink/control 规则。
8. 计算 `threat_score`。
9. 计算 `rule_score`。
10. 计算 `attention_score` 和 priority。
11. 映射 target agent 和 skills。
12. 生成 `attack_hypotheses`。
13. 生成 `pentest_strategy_queue`。
14. 写入 `strategy_coverage` 和 checkpoint。

## Dispatcher 接入

第一版保留现有 `build_agent_contracts.py` 的行为，但新增策略队列接入路径：

- 如果存在 `artifacts/strategy-planner-agent/pentest_strategy_queue.json`，dispatcher 优先按策略队列分组生成 contract。
- 如果不存在策略队列，继续使用 `recon_priority_queue.json + threat_model.json` 的旧路径。

生成 contract 时：

- `inputs.strategy_tasks` 来自 `pentest_strategy_queue.items`。
- `inputs.recon_priority_items` 继续保留，用于兼容旧 Agent。
- `inputs.threats` 由 `source_threat_ids` 回查原始 threat。
- `evidence_requirements` 合并策略任务中的 `required_evidence`。
- `completion_criteria` 必须覆盖策略任务的 stop conditions、blocked root causes 和安全限制。

## Agent 职责变化

### strategy-planner-agent

新增 Agent，职责：

- 读取 recon 产物。
- 生成威胁加权测试任务。
- 生成攻击假设。
- 生成 recon gaps。
- 不执行测试，不产出 finding。

### recon-agent

职责不变，但质量要求提高：

- 威胁项必须尽量包含 entrypoint、asset、boundary、attacker、next_agent、priority、evidence。
- 如果 strategy planner 输出 recon gap，下一轮优先补 threat model，而不是让动态测试层猜测。

### dispatcher-agent

从“按 agent 粗分 recon queue”升级为“按 strategy task 分组”。

### evaluation-agent

评价时加入 strategy coverage：

- 高 attention_score 的任务如果未执行，形成 coverage gap。
- 高 attention_score 的任务如果 blocked，必须记录 blocked root cause。
- 高 attention_score 的任务如果只产出低证据 finding，标记为 needs_dynamic_verification 或 needs_source_correlation。

### debug-agent

调试时可把 missed finding 反推到：

- threat model 缺失。
- rule mapping 缺失。
- scoring 权重不合理。
- skill 映射不合理。
- 下游 Agent 执行失败。

## 安全约束

- Strategy planner 不生成超出 `scope.json` 的测试任务。
- 对 mutation task，必须引用 allowed mutation；否则只生成静态/只读检查或 blocked。
- DoS 类任务只允许配置审计和轻量限速检查，不允许高强度压测。
- 文件上传、导入、导出只允许无害样本和授权范围内路径。
- 不生成真实支付、短信、邮件轰炸、数据删除、持久化 payload 或后门相关任务。
- 不把 token、cookie、密码、验证码、个人资料原文写入 strategy artifacts。

## 失败与降级

| 情况 | 行为 |
|---|---|
| 缺少 `scope.json` | 停止，strategy coverage 写 failed |
| 缺少 `threat_model.json` | 停止，要求 recon-agent 补产物 |
| threat 缺少 entrypoint 或 boundary | 生成 recon gap，不生成高优先级执行任务 |
| 入口超出 scope | 写 blocked，不生成执行任务 |
| mutation 不允许 | 降级为静态检查或只读浏览器观察 |
| skill 映射为空 | 写 strategy gap，要求补规则映射 |
| 所有 threat 都无法成任务 | strategy coverage 为 blocked，不进入 dispatcher |

## 验收标准

1. 新增中文 spec 和后续中文 plan。
2. 新增 `strategy-planner-agent` 文档。
3. 新增 `threat-weighted-strategy` skill 或同等策略规划 skill。
4. 新增 `pentest_strategy_queue.schema.json`、`attack_hypotheses.schema.json`、`strategy_coverage.schema.json`。
5. 新增工具从样例 recon 产物生成策略队列、攻击假设和 coverage。
6. 每个策略任务都有 `threat_score`、`rule_score`、`attention_score`、priority、target agent、skills、required evidence、stop conditions。
7. 缺少威胁关键字段时生成 recon gap，不生成伪高危任务。
8. dispatcher 能优先消费策略队列；策略队列不存在时兼容旧流程。
9. 现有测试全部通过。
10. 核心 Agent/Skill 不出现任何具体靶场绑定。

