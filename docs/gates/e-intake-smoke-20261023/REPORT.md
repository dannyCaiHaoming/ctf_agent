# E 取題真實模型冒煙報告（2026-10-23）

結論（design v1 1.6 層級）：**帶真實題目時,Intake 能經受管工具讀到題目,取題鏈在真實模型下端到端成立**。涵蓋題目清單 → 啟動前可達性檢查與材料固定 → Intake 經 `ctf_challenge_list`／`ctf_challenge_read` 讀題 → Coordinator 分派解題角色。不陳述解題能力:被分派的角色尚無解題工具（待 design v1 G）。

## 配置
- 題目:三道本地 Docker Web 題,只綁 loopback——mfw `127.0.0.1:8010`、throwback `127.0.0.1:8001`、seizure `127.0.0.1:8003`,run 準備前三題皆可達、材料（題面 + 原始 `.tar.gz`）已唯讀固定。
- 運行配置在倉庫外 `~/Documents/pentest-agent-run-data/intake-smoke/`(`challenges.json`、`profile.json`);opencode 配置 `config/opencode.volcano-coding.example.json`,模型 `volcano-coding/deepseek-v4-1-flash-261017`,OpenCode 1.19.3。
- 倉庫代碼未改,未 commit。

## Run 1（`~/.ctf-agent/runs/run_628f980f-…`,maxSteps 30）
- `status: budget_exceeded`／`stopReason: budget`,40.x 之前即在第 30 次准入停止(觸發 `maxSteps`,非 provider 錯誤)。token 合計約 45.5k（下限,因停止路徑）。
- Intake 讀到三題(`ctf_challenge_list` 1、`ctf_challenge_read` 6,均放行並執行);Coordinator 綁定 intake、domain-solver、recon;seizure 因預算早停未被分派到解題角色。

## Run 2（`~/.ctf-agent/runs/run_ee734220-f1b0-477e-b491-a462fc2c5ca8`,maxSteps 60,使用者另行授權）
- `status: completed`／`stopReason: completed`(Coordinator 自行收尾,root_idle),第 40 次准入自然結束,未觸及 60 步或 10 萬 token 上限。
- token 合計:input 50,682 / output 13,449 / reasoning 12,434,**complete=true（非下限）**,約 7.65 萬,低於 10 萬。
- Intake 工具:`ctf_challenge_list` 3 次、`ctf_challenge_read` 12 次,審計中全部 allow;**三題（含 seizure）都被讀到**。子會話核對讀到的題面與來源一致(本報告未逐一字面重核每筆讀取,依子會話報告)。
- 綁定角色:coordinator(root)、intake×3、recon、domain-solver、engineer(均 via dispatch)。Coordinator 讀完三題後未對每題各派一個解題角色,屬其自身任務分配,非接線缺陷。
- 密鑰:用 `.env` 的 `ARK_API_KEY` 值對 run 目錄全文 grep,0 命中。
- 無 provider／adapter 錯誤。

## 與 Run 1 的差異
seizure 在 Run 1 的「未分派」只是 30 次准入預算早停所致;Run 2 放寬到 60 後,Coordinator 從容讀完三題並自然結束,seizure 已被 Intake 讀到。取題鏈不存在接線缺口。

## 重跑規則
每次 run 只跑一次;Run 2 經使用者明確授權後才執行。兩次 run 的准入次數均大於 0,按規則不重跑。
