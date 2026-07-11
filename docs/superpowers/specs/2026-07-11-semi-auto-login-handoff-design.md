# 半自动登录人工交接设计

## 目标

为授权渗透测试流程增加通用的半自动登录能力：当浏览器发现授权范围内的登录页面时，暂停后续认证态测试，在页面内显示隔离的“已完成登录，继续测试”控件。测试人员自行完成账号、图形验证码、短信验证码或其他交互式认证；用户确认后，Agent 必须先验证会话，只有确认登录态有效时才恢复渗透测试。

本能力必须同时服务 Codex 和 OpenCode，不绑定特定靶场、业务系统、验证码供应商或浏览器实现。

## 范围与非目标

范围：

- 在 `scope.json` 授权域名和路径内识别任意登录页。
- 在浏览器页面注入隔离的悬浮人工交接控件。
- 记录用户确认、脱敏会话摘要、登录态校验结果、暂停原因和断点恢复状态。
- 使用 Cookie 摘要与 scope 内低风险认证入口校验登录态。
- 认证成功后恢复既有浏览器、API、授权与漏洞验证工作队列。
- 将人工交接和校验状态纳入 `events.jsonl`、`progress.json`、报告上下文与测试人员反馈。

非目标：

- 不识别、读取、保存、转发或自动填写密码、图形验证码、短信验证码、OTP、Cookie、Token 的原值。
- 不绕过验证码、多因素认证、设备指纹、风控或 SSO 安全控制。
- 不在未确认登录态下执行需要认证的页面访问、API 调用或漏洞验证。
- 不实现浏览器扩展；第一版仅定义可由 Codex/OpenCode 浏览器适配器实现的桥接协议。

## 架构

新增 `browser-session-bridge` 作为浏览器适配器和核心编排器之间的边界。`browser-pentest-agent` 负责调度，不能直接依赖 DOM 注入细节或某个浏览器产品。

```text
browser-pentest-agent
        |
        v
login-surface detector
        |
        v
browser-session-bridge
  ├─ 注入 Shadow DOM 悬浮控件
  ├─ 等待用户确认
  ├─ 输出脱敏会话摘要
  └─ 访问受控认证入口
        |
        v
auth-session validator
  ├─ authenticated -> 恢复工作队列
  ├─ waiting_for_user -> 保持人工交接
  └─ blocked -> 记录覆盖阻塞
```

### 组件职责

| 组件 | 职责 | 不负责 |
| --- | --- | --- |
| `login-surface detector` | 通过表单、验证码、OTP、SSO 跳转、登录 API 与项目配置识别登录页 | 判断用户是否已登录 |
| `browser-session-bridge` | 在授权页面中注入控件、监听用户确认、生成脱敏浏览器会话观察 | 读取任何敏感字段原值 |
| `auth-session validator` | 校验 Cookie 元数据和低风险认证入口响应，给出 `authenticated`、`waiting_for_user` 或 `blocked` | 猜测会话是否有效 |
| `browser-pentest-agent` | 暂停/恢复工作队列，写入运行事件和 checkpoint | 特定浏览器 DOM 操作 |
| `report-agent` | 呈现人工交接状态、会话校验状态与覆盖缺口 | 将阻塞伪装为漏洞 |

## 页面控件与登录识别

对授权范围内任何页面，以下任一信号均可产生 `login_handoff` 候选：账号密码表单、验证码图片或验证码输入元素、OTP 输入元素、SSO/OIDC/SAML 跳转、运行时捕获的登录 API、或项目配置指定的登录路由。

确认候选后，bridge 使用唯一宿主节点和 Shadow DOM 注入悬浮控件。控件只显示当前状态、脱敏错误类别、重试入口和“已完成登录，继续测试”按钮；不得改变业务表单字段、提交逻辑或页面路由。重复发现同一页面时必须幂等，不能重复创建控件。

控件只能注入 `scope.json` 的 `allowed_hosts` 和 `allowed_paths`。页面离开授权范围、运行被取消或登录已确认后，bridge 必须移除控件。

## 状态机与数据流

1. `browser-pentest-agent` 发现登录候选后写入 `login_handoff.json`，状态为 `waiting_for_user`，同时写入 `checkpoints/auth-login-handoff.json`、`progress.json` 和 `events.jsonl`。
2. bridge 在页面中显示控件。测试人员直接在业务页面中完成登录、图形验证码、短信验证码或其他人工认证步骤。
3. 用户点击“已完成登录，继续测试”。该点击是人工确认信号，但不等于登录态已验证。
4. bridge 生成会话摘要，并调用 validator。摘要只包括 Cookie 名称、域、路径、`HttpOnly`、`Secure`、`SameSite`、过期时间和不可逆指纹；绝不包含 Cookie 值。
5. validator 检查候选 Cookie 是否属于授权域且未过期。若未观察到 Cookie，记录 `cookie_not_observed`，允许继续由认证入口判断，不得直接判断登录成功。
6. validator 使用项目配置或运行时发现的、在 scope 内的低风险 `GET` 或 `HEAD` 认证入口进行校验。登录页重定向、401、403、身份不一致或响应不符合成功条件均视为失败。
7. 成功时写入 `authenticated` checkpoint 和 session validation artifact，恢复未完成且未重复的认证后任务。失败时返回 `waiting_for_user`，控件提示原因并允许重试。无法验证时写入 `blocked`，不恢复认证后任务。

## Artifact 契约

### `artifacts/browser-pentest-agent/login_handoff.json`

```json
{
  "handoff_id": "auth-login-handoff",
  "status": "waiting_for_user",
  "page_url": "https://target.example.test/login",
  "detection_signals": ["password_form", "image_captcha"],
  "ui": {"injected": true, "isolation": "shadow_dom"},
  "user_confirmation": {"received": false, "confirmed_at": ""},
  "sensitive_values_persisted": false
}
```

### `artifacts/browser-pentest-agent/session_validation.json`

```json
{
  "handoff_id": "auth-login-handoff",
  "status": "authenticated",
  "cookie_observation": {
    "status": "observed",
    "cookies": [{"name": "session", "domain": "target.example.test", "value_fingerprint": "sha256:<redacted>"}]
  },
  "protected_entry_validation": {
    "method": "GET",
    "url": "https://target.example.test/api/me",
    "outcome": "authenticated"
  },
  "sensitive_values_persisted": false
}
```

两份 artifact 均不得保存 URL 查询参数中的敏感值、Cookie 值、Token、密码、验证码、个人信息原文或完整响应体。

## 会话校验与错误策略

Cookie 缺失、过期、域不匹配、路径不匹配、受保护入口重定向到登录页、401、403、角色不匹配或浏览器适配器读取失败时，Agent 必须立即保持 `waiting_for_user` 或 `blocked`，并停止所有依赖认证态的工作项。

| 情况 | 状态 | 后续动作 |
| --- | --- | --- |
| Cookie 观察正常且认证入口确认 | `authenticated` | 恢复认证后工作队列 |
| 用户未确认 | `waiting_for_user` | 保持页面控件与 checkpoint |
| Cookie 异常或入口认证失败 | `waiting_for_user` | 提示脱敏原因，等待用户重新登录并确认 |
| 无认证入口、跨域限制或适配器能力缺失 | `blocked` | 不继续认证后测试，向报告输出覆盖阻塞 |

恢复操作必须使用现有 `test_trace_ledger` 的去重信息，仅恢复未完成或需要重试的任务。`events.jsonl` 每个关键事件必须包含分析、计划、执行方式、结果与下一步；对敏感值执行运行时脱敏。

## 配置扩展

`lab_profile.json` 的 `auth_surface.login` 可选增加以下配置：

```json
{
  "handoff": {
    "enabled": true,
    "force_manual": false,
    "protected_entry": {"method": "GET", "path": "/api/me"},
    "success_indicators": {"status_codes": [200], "url_not_contains": ["/login"]}
  }
}
```

默认策略为：发现任意登录页时触发人工交接；`force_manual` 用于项目明确要求即使无验证码也必须由用户完成登录。缺少 `protected_entry` 时允许从已有 `auth_surface.login.api_candidates`、运行时 API 观察或 `scope.protected_resources` 中选择低风险候选；仍无法选择时必须标记 `blocked`。

## 测试与验收

自动化测试必须覆盖：

- 登录表单、验证码、OTP、SSO 和配置驱动的识别信号。
- 授权范围外页面不注入；相同页面只注入一次；结束或离开范围后清理控件。
- 用户确认前不产生认证后测试任务；确认后成功校验才恢复。
- Cookie 正常、缺失、过期、域不匹配与仅 Storage 会话场景。
- 认证入口的成功、重定向、401、403、角色不匹配和无可用入口场景。
- 多次重试和进程重启后从 checkpoint 恢复，不重复执行已完成任务。
- artifact、事件日志、进度和报告上下文不包含密码、验证码、Cookie/Token 原值。

验收标准：在支持浏览器 bridge 的适配器上，测试人员可在授权站点自行登录，点击控件后看到明确的成功或失败状态；只有成功状态才会执行认证后页面、API 和漏洞验证任务。适配器能力不足时，核心 Agent 必须产生可行动的 `blocked` 反馈，而不是宣称已经登录或继续测试。
