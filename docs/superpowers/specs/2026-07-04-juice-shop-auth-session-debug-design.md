# Juice-Shop 登录态与双账号权限调试设计

## 背景

上一阶段已经完成靶场驱动调试闭环：`labs/juice-shop` profile、expected findings、`debug-agent`、`init_lab_run.py`、`compare_lab_expected_findings.py`、`update_regression_from_lab_debug.py` 已经可运行，并且能够把漏报、误报、blocked 项转成 regression cases 和 lessons。

下一阶段选择 **B 方案：登录态/双账号权限测试优先**。目标不是立刻追求所有 Juice-Shop challenge，而是先把 `browser-pentest-agent` 的认证、会话、双账号权限矩阵和动态证据采集打磨具体。用户的本地 Juice-Shop 已打开在 `http://localhost:3000/#/`。

公开资料中，Juice-Shop companion guide 把 `Login Admin`、`Login Bender`、`Login Jim`、`User Credentials` 等列为 challenge 主题，但这些更适合作为预期漏洞与训练目标，不应作为产品默认测试账号硬编码。第一版应优先使用用户提供的测试账号；若没有账号，再支持本地靶场安全注册两个普通测试账号。

## 目标

本阶段构建一条登录态调试链路：

```text
accounts.local.json / 环境变量 / 自动注册测试账号
  -> auth session run 初始化
  -> 登录状态采集
  -> 会话存储观察
  -> 双账号权限矩阵
  -> runtime API 观察
  -> dynamic_evidence
  -> debug-agent blocked/missed/found 归因
```

完成后，系统应能回答：

1. 是否有可用测试账号？
2. 每个账号能否成功登录 Juice-Shop？
3. 登录前后 cookie、localStorage、sessionStorage 是否发生变化？
4. 退出后受保护页面/API 是否仍可访问？
5. user A 和 user B 对购物车、订单、地址等资源访问是否存在越权迹象？
6. 如果测试被阻塞，阻塞原因是账号缺失、登录失败、页面元素变化、API 不可达，还是证据不足？

## 非目标

本阶段不做暴力破解、不使用真实用户账号、不提交真实支付、不进行 DoS、不写持久化 payload、不自动完成破坏性 challenge。

公开 challenge 账号或 challenge 线索只进入 `expected_findings` 或回归知识，不作为默认登录凭据写入仓库。真实凭据不得进入 git。

## 账号来源策略

按优先级加载账号：

1. `runs/<run_id>/accounts.local.json`
2. 环境变量，例如：
   - `JUICE_SHOP_USER_EMAIL`
   - `JUICE_SHOP_USER_PASSWORD`
   - `JUICE_SHOP_SECOND_USER_EMAIL`
   - `JUICE_SHOP_SECOND_USER_PASSWORD`
3. `labs/juice-shop/accounts.example.json` 只作为字段模板。
4. 如果未提供账号，允许后续真实浏览器阶段注册两个低权限测试账号：
   - `pentest.user.a+<run_id>@example.test`
   - `pentest.user.b+<run_id>@example.test`

自动注册必须满足：

- 只在 `lab_profile.mode == "graybox-lab"` 且 `target_url` 为 localhost 时启用。
- 密码生成后只写入 run 目录，不写入仓库。
- 注册失败时输出 blocked，不继续伪造 found。

## 新增数据结构

### accounts.local.json

运行目录中的真实账号文件，不提交仓库。

```json
{
  "lab_id": "juice-shop",
  "accounts": [
    {
      "role": "standard-user-a",
      "email": "pentest.user.a@example.test",
      "password_env": "JUICE_SHOP_USER_PASSWORD"
    },
    {
      "role": "standard-user-b",
      "email": "pentest.user.b@example.test",
      "password_env": "JUICE_SHOP_SECOND_USER_PASSWORD"
    }
  ]
}
```

规则：

- `password` 明文字段默认禁止。
- 本地运行可以通过环境变量解析密码。
- 若后续必须支持明文密码，只允许在 run 目录临时文件中，并且报告中必须脱敏。

### session_observations.json

由 `browser-pentest-agent` 写入：

```json
{
  "lab_id": "juice-shop",
  "target_url": "http://localhost:3000",
  "mode": "browser-auth-session",
  "accounts": [
    {
      "role": "standard-user-a",
      "login_status": "authenticated",
      "login_url": "http://localhost:3000/#/login",
      "post_login_url": "http://localhost:3000/#/",
      "storage_observed": {
        "cookies_changed": true,
        "local_storage_keys": ["token", "email"],
        "session_storage_keys": []
      },
      "logout_status": "not_tested",
      "evidence": [
        "artifacts/browser-pentest-agent/screenshots/login-standard-user-a.png"
      ]
    }
  ],
  "blocked": []
}
```

状态枚举：

- `authenticated`
- `failed`
- `blocked`
- `not_tested`

### auth_matrix.json

描述双账号/双角色访问矩阵：

```json
{
  "lab_id": "juice-shop",
  "resource_types": ["basket", "order", "address"],
  "checks": [
    {
      "check_id": "AUTHZ-001",
      "resource_type": "basket",
      "owner_role": "standard-user-a",
      "actor_role": "standard-user-b",
      "method": "GET",
      "url": "http://localhost:3000/rest/basket/<id>",
      "expected": "denied",
      "observed": "not_tested",
      "status": "blocked",
      "reason": "basket id not discovered yet",
      "evidence": []
    }
  ],
  "summary": {
    "total": 1,
    "allowed": 0,
    "denied": 0,
    "blocked": 1,
    "suspicious": 0
  }
}
```

状态枚举：

- `allowed`
- `denied`
- `blocked`
- `suspicious`

### runtime_api_observations.json

登录/权限测试过程中观察到的 API：

```json
{
  "lab_id": "juice-shop",
  "source": "browser-network",
  "apis": [
    {
      "method": "POST",
      "url": "http://localhost:3000/rest/user/login",
      "trigger": "login",
      "actor_role": "standard-user-a",
      "status": 200,
      "request_fields": ["email", "password"],
      "response_fields": ["authentication"],
      "sensitive_fields_redacted": true
    }
  ]
}
```

## 工具设计

第一阶段先实现文件级可测工具，不直接依赖真实浏览器：

1. `tools/load_lab_accounts.py`
   - 读取 run 目录 `accounts.local.json` 或 lab 模板。
   - 解析 `password_env`，不打印密码。
   - 产出 `artifacts/browser-pentest-agent/account_inventory.json`。
   - 缺少密码或账号时输出 blocked reason。

2. `tools/build_auth_session_plan.py`
   - 读取 `lab_profile.json`、`scope.json`、`account_inventory.json`。
   - 生成 `artifacts/browser-pentest-agent/auth_session_plan.json`。
   - 明确登录 URL、允许动作、双账号矩阵候选。

3. `tools/write_simulated_auth_session_observations.py`
   - 用于第一阶段测试。
   - 根据 account inventory 生成模拟 `session_observations.json`、`auth_matrix.json`、`runtime_api_observations.json`。
   - 若账号 blocked，则 dynamic evidence 也写 blocked。

真实浏览器阶段再接入 in-app browser/Playwright：

- 点击登录入口。
- 填写账号。
- 监听网络请求。
- 采集 storage/cookie。
- 比较 user A/user B 资源访问。

## Agent/Skill 调整

### browser-pentest-agent

新增明确步骤：

1. 调用 `lab-profile` 确认 target 和安全边界。
2. 调用 `auth-session-testing` 加载账号。
3. 建立匿名会话 baseline。
4. 建立 user A、user B 登录会话。
5. 写入 `session_observations.json`。
6. 基于观察到的 basket/order/address/API 写入 `auth_matrix.json`。
7. 将无法完成的项写为 blocked，不写为 found。

### auth-session-testing skill

需要从通用描述升级为可执行检查清单：

- 账号加载规则。
- 登录成功判定。
- 登录失败判定。
- storage/cookie 观察字段。
- logout 观察字段。
- 双账号资源矩阵构建规则。
- blocked 输出条件。

## Debug 归因

新增 blocked root cause：

| root_cause | 场景 |
|---|---|
| `browser.account_missing` | 没有可用账号或密码环境变量 |
| `browser.login_failed` | 登录表单提交后未进入登录态 |
| `browser.selector_changed` | 登录入口、输入框、按钮定位失败 |
| `browser.resource_id_missing` | 未发现 basket/order/address 等资源 id |
| `browser.network_capture_missing` | 无法采集登录/API 请求 |

这些 root cause 会进入 `agent_issue_log.json`，再进入 regression cases。

## 安全边界

- 仅允许访问 `scope.allowed_hosts`。
- 默认限速 `max_request_rate_per_second <= 2`。
- 登录测试只使用测试账号。
- 不进行 credential stuffing、password spraying、暴力破解。
- 不自动支付、不删除数据、不持久化 payload。
- 所有密码、token、cookie 在报告中脱敏。

## 测试策略

第一阶段使用本地文件测试：

1. `load_lab_accounts.py` 能从环境变量解析两个账号，输出脱敏 account inventory。
2. 缺少密码环境变量时输出 blocked，而不是失败 traceback。
3. `build_auth_session_plan.py` 能生成登录 URL 和双账号矩阵候选。
4. `write_simulated_auth_session_observations.py` 能生成 session/auth_matrix/runtime_api 三份产物。
5. blocked auth session 能进入 `dynamic_evidence.json`，被 `compare_lab_expected_findings.py` 归入 blocked。
6. `tests/run_all.py`、文档质量门禁和 py_compile 保持通过。

## 交付边界

本阶段交付：

- auth session 相关 schema。
- 账号加载工具。
- auth session plan 工具。
- 模拟登录态观察产物生成工具。
- `browser-pentest-agent` 和 `auth-session-testing` 文档增强。
- 测试覆盖账号缺失、账号可用、blocked、双账号矩阵和 dynamic evidence 对接。

本阶段完成后，下一步才接真实 in-app browser 操作，把当前打开的 `http://localhost:3000/#/` 用于真实登录和网络请求采集。
