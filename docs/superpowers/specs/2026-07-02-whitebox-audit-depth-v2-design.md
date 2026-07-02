# 白盒代码审计深度打磨 v2 设计文档

日期：2026-07-02

## 背景

当前 `pentest-agent-harness` 已完成第一版 MVP：目录结构、Agent、Skill、Phase、schema、工具、报告模板、反馈导入和 Playwright PoC 模板都已经具备。但第一版更接近“可加载的流程骨架”，许多 Agent 和 Skill 仍停留在职责说明层面，缺少可以直接指导 Codex/opencode 执行审计的细粒度方法。

用户反馈的核心问题是：`agents/`、`skills/`、`AGENT.md` 内容还比较空洞，没有具体实现内容。下一阶段应优先打磨白盒代码审计深度，使 Agent 能真正知道：

- 从哪里枚举入口点。
- 哪些变量是 source。
- 哪些函数、框架 API、模板或配置是 sink。
- 如何判断认证、授权、IDOR、Mass Assignment、租户隔离等控制缺失。
- 如何做污点追踪、误报过滤和证据归档。
- 如何把发现转为 finding、coverage 和 regression case。

## 参考开源项目

本设计重点参考 `参考项目/code-audit-main`，并吸收其他参考项目的产品化思想。

### code-audit-main

可迁移内容：

- `SKILL.md` 的执行控制器：模式判定、文档加载、侦察、计划、执行、报告门控。
- `references/core/comprehensive_audit_methodology.md` 的完整攻击面测绘和避免遗漏方法。
- `references/core/sinks_sources.md` 的 source/sink 分类。
- `references/languages/javascript.md` 的 Node.js 双轨审计法：控制建模法 + 数据流分析法。
- `references/frameworks/spring.md` 的 Spring/Spring Boot 专项危险面。
- `references/security/frontend_frameworks.md` 的 React/Vue/SSR 前端安全规则。
- `references/security/authentication_authorization.md` 的认证授权 CWE 映射和控制验证模式。

不直接照搬的内容：

- 不复制所有语言、所有漏洞类型，避免知识库过大但 Agent 不会用。
- 不引入外部命令作为硬依赖，MVP+ 仍以 `rg`、文件读取和标准库工具为主。
- 不把参考项目的英文/中英混合结构原样迁入，本项目文档统一中文。

### security-skill-distiller

可迁移内容：

- Skill 不是静态资料，而是可从漏报、靶场和历史报告中持续蒸馏。
- 每个 Skill 应有输入、步骤、输出、适用边界和回归用例。

### shannon / strix / DeepAudit

可迁移内容：

- 多 Agent 并发不是“同时喊多个 Agent”，而是有明确输入、输出、checkpoint、状态机和评估回路。
- 白盒发现应能和浏览器动态证据、Playwright PoC、人工反馈互相校验。

## 设计目标

v2 的目标不是新增一个完整平台，而是把现有 MVP 的白盒能力从“空壳流程”打磨成“可执行审计 Playbook”。

完成后应满足：

1. Agent 能按技术栈识别审计路线：Java/Spring、Node/Express/Nest、React/Vue/Next.js。
2. Skill 能指导具体审计动作：入口枚举、source/sink 识别、控制建模、污点追踪、误报过滤、证据输出。
3. 每个 finding 必须有代码证据、数据流或控制缺失证据，不能只凭关键词命中。
4. coverage 能说明哪些维度已覆盖、浅覆盖、未覆盖。
5. 漏报反馈能反向更新对应 Skill 或 regression case。

## 第一轮覆盖范围

第一轮优先覆盖用户确认的技术栈：

- Java / Spring / Spring Boot / Spring Security / Spring Data / MyBatis。
- Node.js / Express / NestJS / Fastify。
- React / Vue / Next.js。

第一轮重点漏洞和审计维度：

- 认证缺失与认证不当。
- 授权缺失、IDOR、垂直越权、租户隔离。
- Mass Assignment。
- SQL/HQL/ORM 注入。
- 命令执行、模板注入、SpEL 注入。
- 文件上传、路径遍历、任意文件读写。
- SSRF 和开放重定向。
- 反序列化与危险 JSON 多态配置。
- 前端 DOM XSS、`dangerouslySetInnerHTML`、`v-html`、URL 协议绕过。
- 前端 Token/敏感数据存储、SSR 数据泄露、环境变量泄露。
- 前端 API client 与后端 Controller 不一致导致的隐藏接口、未测接口、权限不一致。

暂不在第一轮深挖：

- C/C++ 内存安全。
- Android/iOS。
- LLM 应用专项。
- 区块链合约。
- 二进制逆向。
- 完整依赖漏洞数据库接入。

## 核心设计：可执行 Skill Playbook

每个白盒 Skill 必须从“说明文档”升级为“执行手册”。统一结构如下：

```markdown
---
name: <skill-name>
description: <一句话说明什么时候使用>
---

# <skill-name>

## 目标

说明该 Skill 解决什么审计问题。

## 适用技术栈

列出 Spring、Express、Nest、React、Vue、Next.js 等适用范围。

## 输入

- `target_profile.json`
- `scope.json`
- recon 输出
- 源码路径
- 相关 artifacts

## 输出

- Agent 专属 artifacts。
- findings。
- coverage 更新。
- regression case 候选。

## 入口点识别

列出应搜索的文件、注解、路由、API client、SSR endpoint 和配置。

## Source 清单

列出该技术栈下可控输入来源。

## Sink 清单

列出危险操作、危险函数、危险配置和危险模板。

## 审计步骤

按顺序说明如何从入口点到控制验证或 source→sink 追踪。

## 误报过滤

说明哪些情况不能报漏洞，必须继续验证。

## 证据要求

定义报告 finding 前必须具备的证据。

## 输出模板

定义 artifacts、finding、coverage 的字段。

## 回归沉淀

说明如何把漏报或确认漏洞转成 regression case。
```

## 双轨审计模型

第一轮白盒能力采用 `code-audit-main` 中非常实用的双轨模型。

### 轨道 A：控制建模法

公式：

```text
缺失类漏洞 = 敏感操作 - 应有控制
```

适用问题：

- 认证缺失。
- 授权缺失。
- IDOR。
- Mass Assignment。
- 多租户隔离缺失。
- 敏感数据导出缺少范围控制。
- 资金、订单、库存等业务操作缺少事务或并发控制。

执行流程：

1. 枚举所有敏感操作：管理接口、数据修改、删除、导出、批量操作、资金操作、权限变更。
2. 为每个操作建立应有控制矩阵：认证、角色、资源所有权、租户、输入校验、审计日志、事务。
3. 阅读实际代码，确认控制是否存在、是否在服务端、是否覆盖所有 CRUD 操作。
4. 对缺失或不一致的控制生成候选 finding。
5. 用动态测试或 PoC 模板补证据，无法复现的进入“需要人工验证”。

### 轨道 B：数据流分析法

公式：

```text
注入类漏洞 = Source → 无有效净化 → Sink
```

适用问题：

- SQL/HQL/ORM 注入。
- 命令执行。
- 路径遍历。
- SSRF。
- 模板注入。
- SpEL 注入。
- DOM XSS。
- 反序列化。

执行流程：

1. 枚举入口点和 source。
2. 枚举 sink。
3. 从 source 追踪到 sink，记录调用链。
4. 检查是否有有效净化、参数化、白名单、类型约束或框架保护。
5. 过滤误报：仅关键词命中、不可达代码、测试代码、不可控输入、已有完整防护都不能直接报漏洞。
6. 形成 finding 或 coverage 记录。

## 需要增强的 Skill

### `recon-enumeration`

目标：从源码、文档、前端、部署配置和权限资料中形成完整作战地图。它不是“扫路由”，而是必须产出攻击面边界、信任边界、数据流、权限边界、初步威胁模型和后续 Agent 的 R1 优先队列。

新增内容：

- Spring Controller、Mapping、Actuator、Gateway、Security 配置枚举。
- Express/Fastify Router、Nest Controller/Decorator、middleware 链枚举。
- React/Vue/Next.js 页面路由、API client、SSR endpoint、server actions 枚举。
- OpenAPI、GraphQL、Swagger、Postman Collection 识别。
- 前后端 API 对齐表：前端调用、后端实现、浏览器观察、文档声明。
- 攻击面边界：业务入口、技术入口、前端入口、部署入口、间接入口、隐藏入口。
- 信任边界：浏览器、前端、网关、后端、数据库、缓存、消息队列、对象存储、第三方服务、内网服务、云 metadata 之间的数据跨越。
- 轻量 STRIDE 威胁分析：每个高风险入口绑定攻击者、资产、边界、威胁类别和后续验证 Agent。
- SKIP/UNKNOWN 覆盖记录：已检查不存在的攻击面写 `skipped`，资料不足的攻击面写 `unknown`。

输出：

- `api_inventory.json`
- `frontend_routes.json`
- `entrypoints.json`
- `auth_matrix.json`
- `attack_surface_boundaries.json`
- `trust_boundaries.json`
- `data_flow_map.json`
- `source_sink_seed.json`
- `high_risk_assets.json`
- `threat_model.json`
- `recon_priority_queue.json`
- `coverage_recon.json`

### Recon 强制边界模型

侦查阶段必须区分 4 类边界。

#### 攻击面边界

攻击面边界描述“从哪里可以进入系统”。必须覆盖：

- 业务入口：登录、注册、找回密码、搜索、上传、导入、导出、支付、订单、后台、Webhook、第三方回调。
- 技术入口：Controller、Router、GraphQL、OpenAPI、WebSocket、SSE、MQ 消费者、定时任务、CLI job、文件解析器。
- 前端入口：React/Vue/Next.js 页面路由、隐藏页面、API client、SSR endpoint、server actions、source map、构建产物。
- 部署入口：Ingress、Nginx、API Gateway、Docker、K8s、暴露端口、Actuator、Swagger、GraphQL introspection、debug endpoint。

#### 信任边界

信任边界描述“数据跨过哪里后信任假设会变化”。必须覆盖：

- 浏览器 → 前端应用。
- 前端应用 → 后端 API。
- API Gateway / Nginx / Ingress → 应用服务。
- 应用服务 → 数据库 / Redis / MQ / 对象存储。
- 应用服务 → 第三方服务。
- 应用服务 → 内网服务 / 云 metadata。
- 匿名用户 / 普通用户 / 租户管理员 / 平台管理员 / 服务账号之间的权限边界。

每条信任边界至少记录 `from`、`to`、`protocol`、`data_types`、`auth_context`、`trust_assumption`、`primary_threats` 和证据来源。

#### 数据边界

数据边界描述“哪些数据一旦跨边界会产生安全影响”。必须标记：

- token、session、refresh token。
- 用户资料、手机号、邮箱、证件信息。
- 订单、金额、余额、积分、优惠券。
- 租户数据、企业数据、项目数据。
- 文件、附件、导出数据。
- 内部配置、环境变量、密钥、云凭据。

#### 覆盖边界

覆盖边界描述“侦查已经确认了什么、跳过了什么、未知什么”：

```json
{
  "checked": [
    {"area": "Spring Controller", "evidence": ["src/main/java/..."]}
  ],
  "skipped": [
    {"area": "GraphQL", "reason": "未发现 graphql 依赖或 schema 文件"}
  ],
  "unknown": [
    {"area": "K8s/Ingress", "reason": "用户未提供部署配置"}
  ]
}
```

`skipped` 不代表安全，只代表当前资料中未发现该攻击面。`unknown` 必须进入后续人工确认或资料补充清单。

### Recon 威胁分析

侦查阶段必须做轻量威胁分析。它不需要证明漏洞存在，但必须指出哪些入口、边界和资产值得优先验证。

威胁模型使用 STRIDE：

- Spoofing：身份伪造、token 混用、服务账号滥用。
- Tampering：参数、状态、金额、角色、租户字段篡改。
- Repudiation：关键操作不可追溯、审计日志缺失。
- Information Disclosure：敏感数据、配置、错误栈、token、跨租户数据泄露。
- Denial of Service：高成本查询、批量导出、文件解析、无限任务。
- Elevation of Privilege：越权、IDOR、Mass Assignment、后台接口暴露。

每个威胁项至少包含：

- `entrypoint_id`
- `boundary_id`
- `asset`
- `attacker`
- `threat_category`
- `why_relevant`
- `next_agent`
- `priority`
- `evidence`

威胁分析的输出不是最终漏洞报告，而是 `recon_priority_queue.json`。后续 Agent 必须据此决定 R1 的审计顺序。

### `taint-analysis`

目标：提供统一 source→sink 追踪方法。

新增内容：

- Java/Spring source：`@RequestParam`、`@PathVariable`、`@RequestBody`、Header、Cookie、Multipart。
- Node source：`req.query`、`req.body`、`req.params`、`req.headers`、`req.cookies`、`req.files`。
- 前端 source：`location.search`、`location.hash`、localStorage、sessionStorage、postMessage、API response。
- Spring sink：`JdbcTemplate`、`createQuery`、`@Query` 拼接、SpEL、文件操作、HTTP client。
- Node sink：`eval`、`Function`、`child_process.exec`、SQL query、fs、axios/fetch、template render。
- 前端 sink：`dangerouslySetInnerHTML`、`v-html`、`innerHTML`、URL 跳转、动态组件。

输出：

- `taint_flows.json`
- `sink_candidates.json`
- finding 候选。

### `control-driven-audit`

目标：系统检查认证、授权、IDOR、Mass Assignment、租户隔离。

新增内容：

- 敏感操作识别规则。
- Spring Security、`@PreAuthorize`、`@Secured`、Interceptor、Filter、Controller/Service 权限检查。
- Express/Nest middleware、Guard、Role decorator、CASL/Ability、自定义 ownership 检查。
- CRUD 权限一致性矩阵。
- 多租户字段检查：`tenantId`、`orgId`、`companyId`、`workspaceId`。
- Mass Assignment 字段：`role`、`isAdmin`、`tenantId`、`ownerId`、`balance`、`status`。

输出：

- `control_matrix.json`
- `authz_gaps.json`
- findings。

### `sink-driven-audit`

目标：围绕高危 sink 反查 source 和防护。

新增内容：

- Spring：SpEL、Actuator、Gateway、SQL/HQL、反序列化、文件上传、SSRF。
- Node：命令执行、原型污染、SQL/NoSQL、路径遍历、模板注入、SSRF。
- 通用：危险配置、硬编码密钥、日志泄露。

输出：

- `sink_inventory.json`
- `dangerous_config.json`
- findings。

### `frontend-static-audit`

目标：把前端作为一等白盒目标。

新增内容：

- React：`dangerouslySetInnerHTML`、动态 props、URL 协议、Redux 敏感数据。
- Vue：`v-html`、动态组件、`:href`、`$el.innerHTML`。
- Next.js：`getServerSideProps`、server actions、API routes、env 暴露、SSR props 泄露。
- 存储：localStorage/sessionStorage/token/PII。
- 开放重定向：`location.href`、`router.push`、`window.open`。

输出：

- `frontend_sinks.json`
- `frontend_storage_findings.json`
- findings。

### `api-client-correlation`

目标：对齐前端调用和后端实现，发现漏测接口和权限不一致。

新增内容：

- 从 axios/fetch/request 封装中提取 method、path、headers、auth usage。
- 从后端 Controller/Router 提取 endpoint。
- 比较差异：前端调用但后端未登记、后端存在但前端隐藏、文档存在但代码未实现。
- 标注每个 API 的认证来源、角色假设和可动态测试性。

输出：

- `api_correlation.json`
- `untested_endpoints.json`
- `hidden_admin_candidates.json`

### `nextjs-ssr-audit`

目标：专项覆盖 Next.js/SSR 安全。

新增内容：

- `getServerSideProps`、`getStaticProps`、`generateMetadata`、server actions。
- `NEXT_PUBLIC_` 与非 public env 边界。
- SSR props 泄露 API key、token、内部 URL、用户权限。
- API routes 和 middleware 的认证授权检查。

输出：

- `ssr_data_exposure.json`
- `nextjs_api_routes.json`
- findings。

## 需要增强的 Agent Contract

### `recon-agent`

必须产出：

- 技术栈识别。
- 后端入口点清单。
- 前端路由清单。
- API client 清单。
- 攻击面边界清单。
- 信任边界清单。
- 关键数据流地图。
- 初始 source/sink/control seed。
- 高风险资产清单。
- 初始权限矩阵。
- 轻量 STRIDE 威胁模型。
- R1 优先队列。
- 攻击面覆盖摘要。

完成条件：

- 至少枚举 Spring/Node/前端三类入口中存在的类型。
- 对未识别的技术栈明确说明原因。
- 对不存在的攻击面写入 `coverage_recon.json.skipped`，并说明证据。
- 对资料不足的攻击面写入 `coverage_recon.json.unknown`，并说明缺少哪些资料。
- 每个高风险资产至少关联一个入口点、一个信任边界或一个数据流。
- 不得凭项目常见结构猜测文件。

### `static-audit-agent`

必须产出：

- sink inventory。
- taint flow 候选。
- control matrix。
- finding 候选和误报过滤记录。

完成条件：

- 对 recon 识别出的敏感操作有覆盖状态。
- 每个 finding 必须包含文件路径、行号、source 或缺失控制、sink 或敏感操作、证据解释。

### `frontend-audit-agent`

必须产出：

- 前端 source/sink 清单。
- API client 与后端 API 相关性证据。
- SSR/存储/DOM sink 风险结果。

完成条件：

- 对 React/Vue/Next.js 中实际存在的框架做专项检查。
- 对所有高危 DOM sink 给出“可控/不可控/已净化/无法确认”状态。

### `evaluation-agent`

必须产出：

- R1 覆盖率矩阵。
- 漏测维度。
- R2/R3 聚焦补测建议。
- finding 质量门禁结果。

完成条件：

- 未覆盖项不能被悄悄忽略，必须进入 coverage。
- 证据不足的 finding 不能进入最终 confirmed，只能进入 manual verification。

## 数据流

```text
target source/docs/accounts
        │
        ▼
recon-agent
        │
        ├── api_inventory.json
        ├── frontend_routes.json
        ├── entrypoints.json
        ├── auth_matrix.json
        ├── attack_surface_boundaries.json
        ├── trust_boundaries.json
        ├── data_flow_map.json
        ├── source_sink_seed.json
        ├── threat_model.json
        └── recon_priority_queue.json
        │
        ▼
static-audit-agent + frontend-audit-agent
        │
        ├── taint_flows.json
        ├── sink_inventory.json
        ├── control_matrix.json
        ├── frontend_sinks.json
        └── finding candidates
        │
        ▼
evaluation-agent
        │
        ├── coverage.json
        ├── evidence_quality.json
        └── focused_retest_plan.json
        │
        ▼
browser / playwright / report / feedback
```

## finding 质量门禁

每个白盒 finding 至少满足以下一类证据：

- 控制缺失证据：敏感操作 + 应有控制 + 实际代码缺失或不一致。
- 数据流证据：source + 调用链 + sink + 缺少有效净化。
- 配置证据：危险配置 + 暴露条件 + 影响说明。
- 前后端不一致证据：前端调用/隐藏入口 + 后端实现 + 权限或文档不一致。

不能报告为 confirmed 的情况：

- 只有关键词命中，没有确认可控输入。
- 只看到危险函数，没有调用链或上下文。
- 只看到前端隐藏按钮，没有服务端验证证据。
- 测试代码、示例代码、死代码，除非明确会部署。
- 已有完整参数化、白名单、权限校验或净化逻辑。

## 错误处理

- 如果无法识别技术栈，Agent 应输出 `unknown_stack_reason`，不能猜测。
- 如果代码量过大，先完成攻击面枚举，再按敏感度排序分批审计。
- 如果某个 Skill 依赖的参考文件不存在，Agent 必须停止对应 Skill 并报告缺失文件。
- 如果 finding 证据不足，进入 `needs_manual_verification`，不能放入 confirmed。
- 如果动态验证超出授权范围，必须由 safety gate 阻止。

## 测试与验收

文档和 Skill 打磨完成后，应增加以下验证：

1. 结构验证：
   - 每个增强 Skill 都包含目标、适用技术栈、输入、输出、入口点识别、source、sink、步骤、误报过滤、证据要求、输出模板。
   - 每个增强 Agent 都包含输入、输出、允许写入路径、完成条件、失败条件。

2. 内容验证：
   - `rg` 检查 Skill 中必须出现 Spring、Express/Nest、React/Vue/Next.js 相关规则。
   - 检查每个 finding 输出模板都要求文件路径、行号、证据类型和置信度。
   - 检查文档中不存在空泛占位标记。

3. 工具验证：
   - 继续运行 `python3 pentest-agent-harness/tests/run_all.py`。
   - 对新增内容结构可增加 `tools/check_skill_depth.py`，检查 Skill 是否满足 Playbook 字段。

4. 人工验收：
   - 随机挑选一个 Spring Controller、一个 Express/Nest Router、一个 React/Vue 组件，让 Agent 按新 Playbook 给出入口、source、sink、控制矩阵和 finding 候选。

## 实施顺序建议

1. 新增参考知识库目录：
   - `references/sources-sinks/`
   - `references/frameworks/spring.md`
   - `references/frameworks/express-nest.md`
   - `references/frameworks/react-vue-nextjs.md`
   - `references/vulnerabilities/authz-idor.md`
   - `references/vulnerabilities/injection.md`

2. 增强核心 Skill：
   - `recon-enumeration`
   - `taint-analysis`
   - `control-driven-audit`
   - `sink-driven-audit`
   - `frontend-static-audit`
   - `api-client-correlation`
   - `nextjs-ssr-audit`

3. 增强 Agent Contract：
   - `recon-agent`
   - `static-audit-agent`
   - `frontend-audit-agent`
   - `evaluation-agent`

4. 增加结构校验工具：
   - `tools/check_skill_depth.py`
   - `tests/test_check_skill_depth.py`

5. 更新 README 和 AGENT：
   - 说明 v2 白盒审计能力。
   - 强调所有后续文档默认中文。

## 非目标

本轮不实现完整自动代码解析器，也不要求构建 LSP 集成。LSP 思路可以写入方法论，但 MVP+ 的可执行方式仍以 `rg`、结构化文件、人工可读调用链和 Agent 推理为主。

本轮不追求“全漏洞类型覆盖”。优先把 Spring、Node、前端这条主线打深，形成可复制模板，再扩展 Python、Go、PHP、.NET。

## 成功标准

v2 完成后，用户再次查看 `agents/` 和 `skills/` 时，应能看到具体到技术栈、漏洞类型、检查命令、证据标准和输出结构的执行内容。一个 Agent 拿到源码后，不需要额外解释，就能按 Playbook 产出：

- 攻击面清单。
- source/sink 清单。
- 控制矩阵。
- 覆盖率矩阵。
- finding 候选。
- 误报过滤记录。
- 聚焦补测建议。

这才算从“框架骨架”进入“可用安全产品”的第一步。
