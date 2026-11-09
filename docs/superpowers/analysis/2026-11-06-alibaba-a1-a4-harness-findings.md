# Alibaba a1–a4 批次：harness 層面的優化方向（待評估）

**狀態：** 用戶的分析結論，尚未核對證據，也還不是 design。由 design session 逐條核對證據，把證據支持的部分回補到對應的 design 章節；本文保留為輸入材料。

**證據位置：**
- a1：`/Users/caihaoming/Documents/pentest-agent-run-data/alibaba-easy-20261104-a1/`
- a2、a3、a4：`runs/alibaba-easy-20261105-a2/`、`runs/alibaba-easy-20261105-a3/`、`runs/alibaba-easy-20261106-a4/`

每批都有結構化報告（`a*-report.md`）。各 run 的 `state/run.json`、`progress.jsonl`、`evidence/control-audit.json`、`evidence/messages-*.json` 只取結構化欄位。

**目前未解出的題組：** bypassit2 0/4（a1、a2、a3、a4），ezbean 0/2，ezoj 0/2。a3 起 Root 續接與分派拒絕原因兩個修正已生效，三題都跑到 30 分鐘 deadline 才停。

## P0-1：host 計算「新資訊量」，不只靠 prompt 裡的有界規則

**現況：**
- prompt 要求「相同工具／參數重複 3 次且無新進展就交回」。
- 但 a3 C1 的 Solver 兩個會話合計約 206 次 job（口徑待核對），C3 的 Solver 有 230 次 HTTP 請求。
- Coordinator 看不到這些重複的參數，背景任務執行中也無法評估。

**方向：** 把「有沒有新資訊」變成 host 可計算的計數器：
- 每個角色、每個工具：相同 argv／請求的雜湊重複次數；
- 最近 N 次調用的唯一結果雜湊數與 HTTP status 分佈，只記雜湊與計數，不記請求或回應內容；
- 距離上次產生新 artifact 雜湊的時間。

**觸發：** 超過門檻（例如最近 20 次只有 1 種結果，或 30 次沒有新 artifact）時，host 向該 child 發固定的 closure 訊息，要求它帶現有證據交回；由 Coordinator 決定換路、派 Critic 或派 Engineer。

這是 Recon 已有的 closure 機制的推廣，不是新的 scheduler，也不是固定步數的 gate。

## P0-2：時間預算分階段，不只有總 deadline

**現況：** a3 C3 的 Verifier 在 28:43 才派出，到 deadline 前來不及完成。

**方向：**
- 在 wall clock 的固定比例（例如 50%／75%／90%）或剩餘約 8 分鐘時，host 向仍在執行的 child 發 closure，要求固定目前最佳候選或交回。
- 保留最後 6–8 分鐘給 Engineer 打包和提交。
- 剩餘時間不夠完成 Verifier 時不派 Verifier；若裁判不限次數且候選出處乾淨，直接走 oracle 優先。

## P0-3：不限次數的裁判放寬出處條件

**現況：**
- a1 A1／A2、a2 B3 三次最後被接受的提交，都先被 `candidate not found in any host http capture` 擋下一次，再花 130–150 秒派 Verifier。
- a3 C3 也被擋了一次，之後因時間不夠沒有完成。

**方向：** 對「次數不限、無冷卻、答錯無懲罰」的裁判，oracle 本身就是最直接的檢查，答錯只多一次提交。HTTP 捕獲出處條件只用於限次、有懲罰或限制未知的裁判；不限次數時直接走 oracle 優先。solved 仍只由裁判回執決定。

**注意：** 這會修改 r22 採用的條件式 Verifier 規則（見[解題延遲](../specs/2026-11-04-design-v1-run-latency-and-context-cost.md) §3.4、[D](../specs/2026-10-24-design-v1-d-candidate-verification-minimal.md) §7）。design 需寫明推翻的理由與證據。

## P1-1：Solver 交回後，Coordinator 需要看到決策所需的狀態

**現況（a4，單次觀察）：**
- Solver 開啟思考後，約 5–6 分鐘就交回。
- Coordinator 的反應是再派 Solver；20.2 分鐘時以 stop_and_report 結束，沒有派 Critic 或 Engineer。

**方向：** host 在每次 Solver 交回時，把以下事實放進 Coordinator 的可見狀態，由 Coordinator 決定換路、派 Critic、派 Engineer 或提交：
- 本輪 Solver 調用數、距上次新 artifact 的時間；
- 剩餘 wall clock；
- 「尚無候選」或「已有候選但未打包」。

**注意：** a4 只有 1 題、1 次，「思考開啟使交回變快」只是觀察。

## P1-2：Coordinator 的 8,000 輸出上限

**現況：** a3 三題各有 1 次 Root 續接，起因都是 `finish=length`。[結果完整性](../specs/2026-10-25-design-v1-run-readiness-and-result-completeness.md) §4.1 已寫明「下一批次的運行設定應提高 Coordinator 的輸出上限或關閉它的思考」。

**方向：** Root 續接是安全網，不是解法。下一批直接關閉 Coordinator 的思考（§3.2 列為低風險），或提高輸出上限。

## P1-3：量測改成配對 A/B

**現況：** a2、a3 的停止規則不同，a4 只差思考開關，三個批次各跑一次，只能看方向，不能下因果結論。

**方向：**
- **先離線：** 用 a3 的 progress 重算 P0-1、P0-2 的 closure 會在何時觸發（0 次模型調用），再定門檻，不要直接燒一批。
- **再配對：** 同三題（bypassit2、ezbean、ezoj）× 2 臂（現況 vs P0 的改動）× 2 次重複。
- **指標：** accepted、首次交回時間、進 Engineer 時間、提交時間、調用數、token、是否觸及 deadline。

## P2：未解出題組的結構化失敗復盤

C3 有候選但流程來不及；C1、C2 則沒有產生候選。建議做一次結構化復盤，按工具與方法缺口歸類。例如：
- 需要瀏覽器執行環境；
- 需要跨請求的會話狀態管理；
- 目標前有請求過濾層；
- 是否有角色反覆等待同一種回應。

缺口確認後再補工具或方法，不用「再跑一次、再調一個開關」代替。

復盤要讀各角色的具體嘗試，屬於授權實驗 session；本文與 design 只記錄分類結果。

### P2 復盤結果（2026-11-08，a3–a6 的 6 個無候選 run）

範圍：a3 C1、C2，a4 D1，a5 E2，a6 F1、F2；6 個 run 都未解出，交回也都未提出候選。讀取各角色交回與嘗試後的分類（一個 run 可多項）：

| 缺口 | run | 次數 |
| --- | --- | ---: |
| Java gadget／序列化施工 | C2、D1 | 2 |
| native RASP／二進位分析 | C1 | 1 |
| 目標特權 helper 的列舉與使用 | E2、F2 | 2 |
| 輸出上限截斷／時間不足 | D1、F1 | 2 |
| 反覆嘗試同一類回應 | C2、F2 | 2 |

沒有 browser 執行環境、跨請求會話狀態或請求過濾層的缺口。C2／D1 缺 Java gadget 施工與序列化工具；E2／F2 缺對目標特權 helper 的列舉與使用；C1 卡在 native RASP；D1／F1 另受 8000 輸出上限影響。C3 已有候選，屬流程／時間問題，未計入本表。

後續先做 a7 的 child 輸出上限調整（[結果完整性](../specs/2026-10-25-design-v1-run-readiness-and-result-completeness.md) §5.2），再視結果決定是否補 Java 施工或特權列舉方法；不以再跑一次代替缺口修補。
