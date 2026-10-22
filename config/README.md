# 配置

CLI 默認使用 `release-profile.m1-opencode.example.json`，模型設置由其引用的 `opencode.m1.example.json` 提供。Provider 憑證僅通過 OpenCode 配置的環境變量引用注入。加載配置不證明餘額或網絡可用。

- `release-profile.schema.json`：release profile 的 schema。
- `release-profile.m1-opencode.example.json`：CLI 默認 profile，引用 `opencode.m1.example.json`。

以下兩份是舊格式樣例，當前 loader 已拒絕其直連模型格式，保留作為拒絕用例（見 `tests/bootstrap/test-harness.test.ts`）：

- `release-profile.example.json`
- `release-profile.m1-bailian-deepseek-v4-flash.example.json`

新配置必須使用 OpenCode 格式；不要重新啟用 JSON 動作協議。
