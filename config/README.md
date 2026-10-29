# 配置

產品 launcher 預設使用 `release-profile.deepseek.example.json`（DeepSeek 官方 API 的 `deepseek-flash`），可透過 `--profile` 覆寫，模型設置由其 `opencode.configPath` 引用的配置提供。Provider 憑證僅通過 OpenCode 配置的環境變量引用注入。加載配置不證明餘額或網絡可用。

- `release-profile.schema.json`：release profile 的 schema。
- `release-profile.m1-opencode.example.json`：引用 `opencode.m1.example.json`。
- `release-profile.deepseek.example.json`：DeepSeek 官方 API，引用 `opencode.deepseek.example.json`。

## DeepSeek 官方 API

在倉庫根目錄的 `.env` 設置 `DEEPSEEK_API_KEY`（欄位範例見 `.env.example`）。launcher 從當前目錄讀取 `.env`，已有進程環境變量優先；密鑰只注入受管 OpenCode 進程，不寫入產品資產或 JSON 配置。`.env` 已被 Git 忽略。

配置使用預裝的 `@ai-sdk/openai-compatible`，連接 `https://api.deepseek.com`。預設為 `deepseek/deepseek-flash`；切換 Pro 時將配置頂層 `model` 改為 `deepseek/deepseek-v4-pro`。思考內容透過 `reasoning_content` 在工具循環中傳遞。範例將單次輸出上限設為 8000 tokens，這是本地保守設定，不是服務商最大輸出能力；不填固定價格以免將時段價格誤記為實測成本。

取得題目、provider/model、批次與 token 預算的明確授權後，從倉庫根目錄執行：

```bash
npx tsx apps/launcher/src/launch.ts
# 需要其他 provider 時，顯式傳入 --profile <release-profile.json>
```

執行前按本批授權調整 profile 的題目與預算。範例數值不構成模型運行授權。

2026-10-29 最小真實驗證通過：OpenCode 1.19.3 → 產品 plugin → ControlService 的 `ctf_progress_read` → 工具結果回傳 → 模型準確返回僅存在於工具結果的 runId。兩次正常 API 請求共 1250 tokens（輸入 1203、輸出 47，包含 384 個快取輸入 tokens），總預算 5000，無重試。驗證使用隔離的精簡診斷提示、關閉思考模式、每次輸出上限 256，以及本地出站請求／預算限制；未改寫 OpenCode 的模型或工具循環。此結果不代表完整九角色求解、思考模式或解題能力驗收。

官方依據（2026-10-29 核對）：[首次調用 API](https://api-docs.deepseek.com/zh-cn/)、[模型細節](https://api-docs.deepseek.com/zh-cn/quick_start/pricing/)、[OpenCode 接入](https://api-docs.deepseek.com/zh-cn/quick_start/agent_integrations/opencode/)。當前 API 名稱以首次調用與模型細節頁為準。

以下兩份是舊格式樣例，當前 loader 已拒絕其直連模型格式，保留作為拒絕用例（見 `tests/bootstrap/test-harness.test.ts`）：

- `release-profile.example.json`
- `release-profile.m1-bailian-deepseek-v4-flash.example.json`

新配置必須使用 OpenCode 格式；不要重新啟用 JSON 動作協議。
