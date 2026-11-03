# 經驗閉環真實模型驗證 plan（r17）

工作模式：授權實驗模式，由用戶親自執行。scope 只限本機 Docker 靶場 `llmctf/2015q-web-throwback:latest`（A）與 `llmctf/2016q-web-mfw:latest`（B），以及本機 controller-side judge；不訪問任何其他目標。
類型：有界驗證。
依據：[Recon 詳細 design](../specs/2026-10-29-design-v1-recon-redesign.md) §3–§8，以及核心 design v1 §1.5–1.6。
依據版本：`main@4f093b82`（含 R3–R6）。
狀態：本 plan 的舊版已執行兩次：r15（2026-10-30）與 r16（2026-10-31）。r16 暴露的問題已寫入 design §8，並由 R3–R6 離線修復。本版是 r17，**尚未授權**；預算等授權參數見 §3，由用戶填寫確認後才可開跑。

## 0. 當前交接

**當前一步：先做 0 token 的整鏈彩排，量出上下文成本；通過後再跑付費的 A→B。**

本批要回答兩件事：
1. R3–R6 的修復在真實模型下是否起作用：
   - 模型會不會讀步驟索引、少做無新前提的重複；
   - Recon 會不會在 closure 前及時交回；
   - Solver／Engineer 的步驟有沒有逐步記錄；
   - episode 是否忠實，不再把晚期失敗泛化成整題結論。
2. 經驗閉環是否走通：A 的 lesson 能否被 B 查到、讀取、核對後採用或拒絕。

本批**不能**證明「經驗讓類似題做得更好」：
- A、B 不是相似題；
- 也沒有不帶經驗的對照組（見 §2.3）。

結論只能寫到「機制在真實模型下有沒有被使用」。

### 0.1 與 r16 相比，產品已經變了的地方
| r16 的問題 | 現在的產品 | 本批要看的行為 |
| --- | --- | --- |
| 每輪改寫上下文，A 准入 44 次即用掉 125 萬輸入 token，因 token 預算停止 | R4：上下文只追加、同版去重 | 每次請求的輸入 token；是否仍在少數幾次調用內耗盡預算 |
| A 88 次工具、0 decision、0 handoff | R4：完整索引、最近步驟與預算狀態每輪可見；R6：Solver／Engineer 可讀全題軌跡 | 重複指紋次數；Recon 是否在 closure 前交回 |
| episode 只覆蓋 16／89 條來源，錯誤泛化 | R5：機械選取＋每步一行的步驟清單 | episode 的 `failed_paths` 是否引用實際步驟；是否仍有錯誤泛化 |
| 只有 Recon 有步驟記錄 | R6：四個綁題角色都寫入 `recon_turns`（帶 `role`） | Solver／Engineer 的步驟是否齊全、可對齊原生調用 |
| B 只讀快照首頁 `done=false` | **未修**（§6 消費記錄未做） | 照舊觀察，只能人工核對 |

### 0.2 執行工具：沿用 r16 批次腳本
r16 批次目錄 `/Users/caihaoming/Documents/pentest-agent-run-data/experience-real-20261031-r16-ab/` 已有完整工具：
- `scripts/start-target.sh`、`stop-target.sh`：起停本機靶場；
- `scripts/run-once.mts`：經 `launch()` 注入本機 judge 並跑單題；
- `scripts/provider-relay.mts`：本機計數 relay，用來核實實際 HTTP 請求數，即「零重發」；
- `scripts/experience-loop-scripted.mts`：0 token 的 A→學習→重啟→B→學習 整鏈彩排，生成全部由本機 loopback 腳本產生；
- `scripts/prepare-batch.mts`：準備與預檢；
- `configs/`：兩題的 profile 與 challenges。

做法：複製為新的批次目錄 `experience-real-<日期>-r17-ab/`，然後：
- 把腳本中寫死的 r16 路徑（`BASE` 等）改為 r17；
- 把預算確認變數 `EXPERIENCE_R16_BUDGET_ACK` 改名並改值；
- 按 §3 更新 profile 預算；
- **刪掉複製過來的 `runs/` 與 `experience.sqlite`**，從空經驗庫開始。

不要沿用 r15／r16 的數據庫：經驗檢索目前不排除同一題自己產生的經驗，同題舊 lesson 會污染結果。

### 0.3 彩排（0 token，必須先做）
在 `main@4f093b82` 上跑 r17 版的 `experience-loop-scripted.mts`，確認：
- 產品插件在真實 OpenCode runtime 中的 R4 hook 正常：
  - 首輪與工具後只追加，不改寫；
  - `context.presented` 有記錄。
  
  這一項此前只有腳本化測試。
- 從 `context.presented` 記錄每次追加的位元組數，估算真題中每次請求的輸入 token。如果每次工具後追加的狀態增量會讓一題的輸入 token 明顯超過 §3 的上限，先停下回報，不跑付費 run。
- 四個角色的步驟都寫入 `recon_turns`，`role` 正確。
- relay 計數與 host 准入一致，確認零重發。

彩排不通過就不進入付費 run。

### 0.4 付費 run 的順序與邊界
1. 運行前凍結：產品 commit、模型與 provider、鏡像 digest、題目材料 hash、角色指令、預算。輸入仍走 Intake，不加任何題目專用提示。
2. A：空經驗庫、新 workspace、新靶場狀態。結束後自動整理 episode 並提煉 lesson；只讀備份數據庫，不人工改 lesson。
3. **A 的題後處理完成、數據庫關閉後，才啟動 B。** 兩題共用同一個數據庫，其餘狀態全部新建。
4. B 透過現有的經驗工具與上下文入口自主查閱，不加「必須參考某條經驗」之類的提示。
5. B 結束後同樣自動整理與提煉。

A 的 lesson 提煉失敗或為空時，B 仍可跑，但閉環一項只能記為「未覆蓋」。A 未解出不是阻塞。每題只跑一次，不重啟、不換模型、不追加批次。

## 1. 題目與限制
| 順序 | 題目 | 用途 | 限制 |
| --- | --- | --- | --- |
| A | Throwback | 從空經驗庫自主解題，產生 episode 與 lesson | 不導入 r15／r16 的軌跡、答案或 lesson |
| B | mfw | 讀取 A 的經驗，觀察方法遷移與「不適用」的核對 | 不帶入舊 mfw 解法；兩題同屬 Web 不代表 lesson 一定適用 |

judge 只用 r16 批次中已核實的 controller-side 實現，不用總是 accepted 的測試 judge。oracle 私有答案只由 judge 讀取，不進模型上下文、日誌或對話。

## 2. 驗收

### 2.1 指標（每題都要報告）
| 指標 | 計算方式（只讀結構化欄位） |
| --- | --- |
| 輸入 token／准入次數 | `state/run.json` 的 `usageTotal`、`admittedModelCalls`；並與 r15、r16 同題對比 |
| 無新前提的重複 | `recon_turns` 中同一 `role`、同一參數指紋重複出現的次數；人工抽查重測時可見意圖是否說明新前提 |
| Recon 交回時機 | 第一條 `kind='handoff'` 的 sequence；Recon cap 狀態是 exploration、closure 還是 exhausted |
| 各角色步驟數 | `recon_turns` 按 `role` 分組計數 |
| 解題結果 | judge 結果分層：solved／partial／candidate_only |
| 題後學習 | episode／lesson 狀態、題後 token 用量 |

### 2.2 行為證據
| 環節 | 必須看到 | 不算通過 |
| --- | --- | --- |
| 過程記錄 | 四個角色的步驟可與原生調用對齊；抽查一個完整回合與一條失敗分支 | 只有行數，無法還原做法 |
| 上下文使用 | 模型的工具調用或文字引用了索引中的舊步驟、指紋或結果，或用 `recon.read` 展開舊步驟 | 索引已投遞，但沒有任何使用痕跡 |
| 及時交回 | Recon 在 closure 前寫 handoff，並說明已確立、已排除、未知的內容 | 由預算或 closure 強制停止 |
| episode | `source_range` 覆蓋全部步驟；`failed_paths` 引用實際步驟；早期成功與晚期失敗並存時沒有錯誤泛化 | 模型補出未發生的步驟；整題結論沒有來源 |
| lesson | 指向 A 的準確 episode 與版本；適用條件、步驟、限制能由來源支持 | 只是欄位合規 |
| B 實際使用 | 查閱發生在行動之前；B 的交付說明借鑑了什麼及依據；之後的工具行動確實使用了該方法並適配 B | 只 search 命中、只 read、事後補一句、或 B 解出 |
| 適用性邊界 | 至少一條經驗經 B 的證據核對後被採用或被放棄，並留下依據 | 沒有不適用案例卻宣稱已覆蓋 |

每個採用案例記一條證據鏈：`A lesson ID@version → B 讀取的 callID → B 的適用理由 → B 的動作 callID／產物 ref → 題目反饋 → B episode 對應步驟`。

### 2.3 本批不能回答的
- **經驗是否帶來增益：** 需要同題、同模型、同預算的「無經驗」對照組 B0，本批不含。
- **對類似題是否有效：** 需要成對的相似題，本批的 A、B 不是。

兩者都留給下一批。下一批之前，最好先完成經驗衛生：同題防回聲、入庫去敏、失敗局只提煉「避免什麼」。

### 2.4 判定
- **閉環通過：** §2.2 各環節都有證據，B 至少一條實際採用案例。缺項只稱部分驗證。
- **機制通過、行為不足：** 記錄與整理完成，但模型沒有使用上下文、沒有及時交回，或沒有採用經驗。按 §2.1 指標定位原因，停止本批，不改樣本重跑。
- **實現錯誤：** 保留原始材料與用量，離線分析修復；修復後的真實複跑要另行授權。

## 3. 授權參數（由用戶填寫確認）
模型與 provider 沿用 r16：`deepseek/deepseek-flash`，經本機計數 relay 接 DeepSeek 官方 endpoint。運行前核實實際解析到的模型與 reasoning 選項並凍結，失敗也不切換 provider。

**用量參考：**
| run | 准入次數 | 輸入 | 輸出 | reasoning | 結束 |
| --- | ---: | ---: | ---: | ---: | --- |
| r15 A Throwback | 154 | 263,989 | 50,340 | 92,940 | completed |
| r15 B mfw | 100 | 208,248 | 39,087 | 53,284 | completed |
| r16 A Throwback | 44 | 1,250,502 | 10,617 | 26,258 | token 預算耗盡 |
| r16 B mfw | 112 | 724,408 | 58,236 | 91,103 | completed |

**輸入 token 是主要成本。** host 的預算按全部輸入計，即使 provider 對快取命中收費較低，也一樣計入，所以 R4 帶來的快取收益不會反映在預算計數上。r16 A 的異常輸入主要來自每輪改寫的投影；R4 改為只追加後，每次工具後仍會追加一段狀態，實際成本要以 §0.3 彩排量出的數字為準。

**建議上限**（與 r16 相同，彩排後可調；這是上限，不是預計消耗）：
| run | 求解 token | 題後 token | 其他 |
| --- | ---: | ---: | --- |
| A | 1,200,000 | 100,000 | `maxSteps` 500、30 分鐘、`maxToolJobs` 100、Recon cap 60／保留 8、學習 10 分鐘 |
| B | 1,200,000 | 100,000 | 同上 |
| **總上限** | **2,400,000** | **200,000** | **2,600,000** |

題後輸入因 R5 的步驟清單與摘錄而增大（約 20–25k token），100k 的題後上限仍足夠，但兩次題後請求共用這個上限。

**由用戶確認的項目：**
- [ ] 目標：只限上述兩個本機靶場
- [ ] 模型／provider：`deepseek/deepseek-flash`，經本機計數 relay
- [ ] 批次：A、B 各一次，無自動重試、不換 provider
- [ ] 總 token 上限：____（建議 2,600,000）
- [ ] 不 commit、不 push 運行產物

## 4. 收口
- 原始運行產物留在批次目錄。最小去敏證據歸檔到 `docs/gates/`：指標、結構化計數與證據鏈，不放 transcript 或工具原文。
- 結論回寫 design §8：更新 r16 的正反證據，並把「仍未證明的事項」中被本批回答的條目改掉。
- 收口後刪除本 plan。design 不反向引用本 plan。
