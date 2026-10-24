# design v1 C／D 詳細 design：交接資訊保留與局部修正

記錄日期：2026-10-24（Asia/Tokyo）。

**狀態：離線交接核對完成；Coordinator／Verifier 最小指令修改已實作並通過無模型定向回歸，效率改善仍未驗證。** 本文是 [核心設計 v1](2026-10-22-ctf-agent-design-v1.md) §1.2、§2 C／D 的子文件。承接已完成的產品指令契約清理，只研究如何利用既有原生 task、artifact、package、verification 與進度接口，保留下一角色實際需要的資訊，減少沒有證據理由的重新探索。

## 1. 目標與範圍

希望接手者知道：目前要回答什麼、哪些觀察已成立、哪些嘗試被否定及其適用條件、證據在哪裡、此次只需補哪一項。交接是可核查的工作結果與證據索引，不是私有推理轉錄，也不保證先前角色的結論正確。

本次核對不擴工具／權限、不新增角色、Schema、持久記憶、檢索服務、judge 或控制循環；不新增 Skill，不變更獨立驗證或 solved 標準。後續若證明現有接口無法傳遞必要資訊，先在本文記錄具體缺口及方案，再決定是否擴大範圍。

## 2. 已知證據與未知

核對基線：`c8b13bf566297812aa5113ce0ec5feaf159acab0` 加當前未提交實作及已完成的產品指令清理。成功 run `d-e2e-mfw-20261024-b2-1` 的去敏總結見 [既有 gate](../../gates/d-e2e-mfw-20261024-b2/REPORT.md)。原始消息與報告留在既有外部 run 資料目錄，不複製題目解法、候選、答案或推理到 repo。

已核對的事實：

- Engineer 與 Verifier 共約佔該 run observable tokens 的 68.5%；這是成本定位線索，不是浪費判定。
- 14 次原生 task 呼叫中有 3 次帶 task_id（Solver 2 次、Verifier 1 次）。已存在局部續用，不能把問題預設成「每次都新建會話」。呼叫帶 task_id 也不單獨證明該 execution 成功完成。
- 4 次 package.publish 均有非空 argv，且輸入均包含 extraction／premises；包內 files 數分別為 4、7、7、9（此處只表示分布，不據此推定時序）。因此不能把根因寫成「沒有腳本或提取說明」；本次對相關往返的內容核對見 §2.1–2.2，不據此宣稱每個包的內容全面充分。
- 4 份已登記報告依序為 3 個 inconclusive、1 個 verified。前三份宿主 blocker 涉及未知前提／未解 issue／完整性與依賴未知／必要來源不完整／缺比較，以及兩份 candidate bytes differ；最後 candidateEqual=true 且無 blocker。必要驗證揭露真實缺口，不能為降低成本省略或改寫。
- 現有 package 已能固定 candidate byte 區間、files、argv、extraction、premises；報告已有 issues、premises、sourceFlow、evidence。現有 task 可攜帶必要交接文字，優先利用這些位置。
- control-service 的 resume 核實父所有權、角色、同題與前次 execution 已結束。Verifier 的 preparation／job evidence 綁定 execution 及 version；續用 session 不等於可沿用舊句柄、報告或舊版本驗證。

### 2.1 離線核對條件與證據索引

2026-10-24 在獨立工作區核對上述基線及當前必要未提交 source／docs；原 run 使用 `volcano-coding / deepseek-v4-1-flash-261017`，本次未啟動模型或 Docker。原 run 與後來的產品指令清理不是同一版本的行為證據，不把本結論當成清理後效果。以下檔案均位於外部 `~/Documents/pentest-agent-run-data/d-e2e-mfw-20261024-b2/runs/d-e2e-mfw-20261024-b2-1/evidence/`，只讀，未複製。讀取限 task 分派／交回、最終交付、必要工具輸入輸出及已登記報告，未讀 reasoning parts。

核心索引為 `task-executions.json`、`verification-results.json`、`publications.json` 和 `messages-<session>.json`。Coordinator session 為 `ses_e92added9ffeYIlcrh1ljeWqsD`。按 publish 返回 version、task execution 綁定及報告 createdAt 還原，並非按檔名排序：

| 次序與交接 | 固定版本／execution／報告 | 關鍵證據與結果 |
| --- | --- | --- |
| Engineer 初次發布 → 首次 Verifier | version `cfc72add-bb7b-4cf8-9dc6-aacc0e71c6b7`；Engineer execution `487e4d38-c96a-426f-a31c-d507abaee996`；Verifier `063db496-c77c-480d-abb6-a0aac1714ac1`；report `abe7fb0b-3108-43c9-80b9-d1b4141e72ef` | publish `call_00_xrlr7ecgruy9vm4hrlpq8qxe`（4 files）；report `call_00_rvt564ci3x6alheg7kp00qjy`；inconclusive，來源／前提缺口及缺 comparison。Coordinator 讀回 `call_00_q6wlolg6rjpc3to96xotp4qm` 後轉 Solver 補來源，再交 Engineer。 |
| 第二次 Engineer 的兩次發布 → 中間 Verifier／狀態續問 | versions `373486d4-bbde-419a-8311-35270a5a73d6` → `ce25bba6-2301-4370-bebc-468ea5539b38`；Engineer `0a373361-b48f-43a3-8682-f1b6f18439ca`；Verifier `ed65b25b-c637-4257-ac36-d4895081d52a` → 狀態 execution `27474baf-5d48-486c-9cf1-8109df19bee8` | publish `call_00_r4lcsa6kb1agkc3x0a64r5dm`／`call_00_cb7q05mwe0uzmw2c5ff7p9mh`（各7 files）。最終版交 Verifier；**這兩版沒有已登記報告**。續問明確限狀態、不得重跑／重登記；交回說尚未登記，保留來源一致性問題。不能把四個 publish 與四份報告一一配對。 |
| Solver 補新來源 → 第三次 Engineer → 第二份報告 | version `795238ea-30a6-4c64-b343-e9065d06abee`；Engineer `f1e5d734-cce8-4fc2-ad7d-0f9d125f98e3`；Verifier `726b18ac-9728-43d2-ab57-fae3254b1c12`；report `96252dac-022c-4027-8354-18c345cc3eb4` | publish `call_00_7oq6wx4y9a9ogr3dmmgrpnpj`（9 files）；report `call_00_kg91fsrdra9e6fzpz8np0hoa`。original verified、effective inconclusive；comparison evidence 5 `[0,5394)`，另有必要前提、issues、來源 blocker。 |
| 同版的新驗證 execution → 第三份報告 | version 同上；Verifier `e7562209-7802-4692-82f8-3fbf095c06c7`；report `e3bd179f-67de-4153-be09-d106cb32626a` | report `call_00_s19y3axa9o8uv75rcgtlzr7q`；comparison evidence 0 `[362,662)`；唯一 host blocker 為 candidate bytes differ。其後 `call_00_h1cin2ypais03u85uxbu12eu` 嘗試改 premises 被 conflicting report 拒絕，未形成第五份報告。 |
| 再次同版的新驗證 execution → 第四份報告 | version 同上；Verifier `05e48886-1195-4e50-a68b-ded0be5aefff`；report `e2e30941-b23d-46f6-a12d-dba68bd97a88` | report `call_00_4r7jpe36l59r49udxq4x9a1d`；comparison evidence 0 `[0,33)`；candidateEqual=true、無 blocker、effective verified。未再發布包，不能解釋成改包才通過。 |

### 2.2 問題分類、反例與界限

1. **原本缺證據／必要獨立確認（missing evidence／necessary verification）。** 初次 Engineer 的最終交付已保留 producer 完整性未知；Verifier 的不足不是 Coordinator 把完整來源弄丟。補來源、核對來源一致性以及改用新材料是有依據的返工。中間 Engineer 自己報出一致性疑點，Coordinator 在 `call_00_ohi6wu5gifrkqbyjoy40sca8` 將疑點及「也可能是重算方法有誤」一起轉給 Verifier，屬保留反例，而非丟失負向資訊。不能把這段驗證刪掉來省成本。
2. **未證實轉交遺失（transfer loss）或普遍未讀（unread evidence）。** 三次 Engineer 分派提供的新增來源 ref，接手分別對 3／3、3／3、4／4 個 ref 發出 artifact.read 並成功返回；第二次計數排除舊 package version 引用。初次讀取定位 `call_00_0u37u0t7quhum6go0cfx2r8p`、`call_02_kl6zskrfiaefmnixmptx04ta`、`call_00_hijuxz2m1z3o1zhhw0z576vt`；第二次 `call_00_e7k88ynx5tyn1f4mgn8lb8ki`、`call_01_u6k5vnt7ckuzm9vzuic15d8d`、`call_02_d2kl75j8zplrejqi7t9yeb3v`；第三次 `call_00_glz79jt3md1k93iivsa4hgkp` 及同批3次讀取。Verifier 亦有 prepare／package.read。此處未逐項審核所有分頁與每個字節是否讀完；成功返回不等於完整閱讀或理解正確，但不能把已有讀取說成缺引用或完全沒看資料。第一、第二 Engineer 最終交付各記錄過手工轉錄偏差後校正，這是 bytes 使用問題，不是缺 ref。
3. **修正任務的語義失真／方法使用問題。** 第二份報告後 Coordinator 讀回 `call_00_67d6mzpmzbaydiv33cygdv80`，但在修正 task `call_00_yzs1f326zkrtv6efopysq6b6` 將 comparison 描述為「包含 byte-equality 的 job 區間」，並將先前 mismatch 解釋為使用外會話 candidate artifact。接手者隨後選了300-byte 結果片段，仍不等於33-byte候選。當前 owning source `apps/launcher/src/verification-results.ts` 實際比較的是 evidence 解碼後子區間的原始 bytes；不是解讀 JSON 裡的相等性陳述。故至少此輪不能單純判為未遵循已完整交付指示，也不能認定 package 候選錯誤。
4. **未取得 blocker 就猜測修正。** 第三份報告的工具回應僅 result／duplicate／effectiveJudgment；Verifier 最終交付猜測 assumed premises 造成降級，試圖清空 premises，遇到衝突拒絕後重新 prepare，仍為同 execution。Coordinator 在 `call_00_hjtay7s8v1wbfnawp5sv9zzu` 讀回完整報告後，才以 task `call_00_l98811x45lhur5v4dgy8wefb` 明確指出唯一 blocker 及原始 bytes 區間語義，並要求保留誠實 premises／issues／requirements。這是現有角色可見資訊差異和修正定位問題；先利用既有 Coordinator 讀回路徑，不據此新增 runtime 欄位或權限。
5. **保留成功與失敗反例。** 最後兩次報告同版，機械比較區間修正後通過，沒有改包；這只支持本樣本的故障定位。中間 Verifier 的空交回後以同 session 狀態續問取得結果，亦反駁「每次必須新 session」；但該 session 沒有登記報告，不能算驗證成功。其工具 `call_00_u5jvute6vc5ewvmydmw1fv8h` 有 unavailable tool 錯誤；僅憑該錯誤與短交回不能證明傳輸失效根因。

**仍未知：** 每項重讀的必要性、模型為何選錯區間、跨 session 相對成本以及約定能否降低真實消耗。既有證據不支持「所有往返均浪費」、「摘要更長即可解決」或「修改兩個角色就保證省 token」。未將原始命令、候選／flag、題目解法或私有推理保存到本文。

## 3. 候選做法與取捨

| 做法 | 預期作用與代價 | 當前去向 |
| --- | --- | --- |
| A. 現有角色交付增加簡短的任務差量與證據對照 | 利用現有 task／package／report，讓接手者知道本輪需要補什麼；增加少量文字，須防止變成固定長表格 | 僅定稿 Coordinator／Verifier 的 blocker 與比較語義差量；其餘一般交接建議保持候選 |
| B. 新增宿主 handoff schema 或自動彙總服務 | 可機械檢查欄位，但不能判斷內容充分性；增加框架、重複狀態與維護 | 當前不採用；只有 A 受明確接口缺口阻塞時再評估 |
| C. 強制復用所有 session 或減少 Verifier | 可能降低重新載入成本，但也保留錯誤假設並削弱獨立性 | 不採用；按任務與證據條件選擇復用，保留必要驗證 |

## 4. 方案 A 的候選交接約定

以下一般交接內容仍為候選；§5.1 的 Coordinator／Verifier 最小子集已依離線證據定稿，其中最小子集已依 §7 接入產品，其餘仍非產品規則。採自然語言短段即可；不要求每次填滿固定模板，不讓模型手填宿主已知身份、hash、時間、計數或可信狀態。

### 4.1 接手者所需的最小內容

- **此次工作**：未解問題與本輪預期交付；局部修正要說清本輪差量。
- **已知與仍未知**：分開觀察、假設、被否定的前提及限制；負向結果不擴大成整條路線不可能。
- **可核查材料**：工具實際返回的 ref／version、每份材料的用途及必要提取位置；私有 work 路徑不能代替發布引用。
- **狀態與再執行條件**：哪些步驟已做、依賴什麼狀態、再次執行是否安全；只有資料有效性改變、獨立確認需要或已指出的缺口才構成重跑理由。

只交付工作結論與必要證據，摘要不代替原始來源；候選透過既有固定引用傳遞，不在進度筆記／Critic 摘要複製候選原文。

### 4.2 各交接邊界

| 交接 | 要保留的有效資訊 | 接手者的責任 |
| --- | --- | --- |
| Recon → Solver（經 Coordinator） | 已確認入口、材料線索、觀察基線、狀態依賴、已檢查而未成立的前提及 ref | 先讀所需證據；需要重查時說明有效性或新假設，不把交接結論當成不可質疑的事實 |
| Solver → Engineer | 已實際執行的最小過程、腳本／輸入／輸出引用、提取位置與轉換規則、仍未確定的前提 | 在自己的工作區整理並核對；缺證據則指出具體缺項交回，不自行連目標重解。編碼／換行／區間修正用既有腳本與固定 bytes，而非手抄候選 |
| Engineer → Verifier（經 Coordinator） | 固定 version、包的用途與驗證所需前提、上輪缺口及本版相關改變；不提供 Solver 私有推理或「應判 verified」指示 | 獨立核對來源與資料流、選擇驗證方法；上一輪結論只是待核查輸入，不能代替本版必要驗證 |
| Verifier → Coordinator → 修正角色 | 指定報告結果、實際 blocker、支持它的 evidence、尚需補的事實；Coordinator 選定責任角色與本輪問題 | 補固定包／提取交 Engineer，補目標觀察交 Solver，前提被反證才回 Strategy／Critic。未知傳輸先暫停受影響交接，不用重新分派繞過 |

Verifier 不替 Solver 寫新解法。若判斷具體需要哪項證據仍不確定，可以明示未知；不得為了使修正單完整而編造處方。Coordinator 讀回完整報告後才轉交缺口，不把原始 judgment、宿主 effectiveJudgment、目前可用性混為一談。

### 4.3 續用與新會話

同題、同角色、原 execution 已結束且原任務仍適合局部修正時，優先評估既有 task_id；按現有 assign／version 契約重新綁定。無合法可用 task_id、任務責任改變或既有上下文已造成錯誤時，可新開同責任會話並交付精簡摘要。不得以新 session 重置預算或繞過 unknown。

Verifier 始終獨立於 Solver／Engineer；同一 Verifier 的續用只保留其自身上下文。新 execution 要重新 prepare 並取得當前綁定的必要證據，不直接重用前次 execution 的 job／preparation。新版本必須重新驗證；不以「只改一點」沿用舊 verified。

## 5. 核對問題與結果去向

離線核對已完成，結果見 §2.1–2.2。本次選擇 A 的最小子集；沒有證據支持全面加長交接格式或新增宿主機制。下列分類規則保留作後續判斷依據。

每個重複或修正片段只需回答：上游已提供什麼、下一角色實際收到什麼、是否讀了相關引用、缺什麼才重做、重做有何合理依據。先讀工具輸入／結果、角色最終交付、已登記報告；不讀或轉錄私有 reasoning 部分，持久文檔只記去敏結論與證據位置，不保存題目專屬提示或解法。

- 若資訊確實遺失或任務差量不清：把對應約定定稿，範圍收斂為相關角色文檔的最小修改，再生成實作 plan。
- 若資訊已完整交付但接手者未使用：保留為模型方法使用問題，只提出具體先讀證據／局部修正約定，不新增宿主欄位。
- 若重做屬有效驗證或已知狀態失效：保留該行為，不以少呼叫為驗收。
- 若實際是工具／bytes／來源契約缺口：記錄原始失敗接口，從本切片剝離；沒有證據前不改 runtime。
- 若既有記錄不足以定位：明示未知，維持候選方案；不得把建議標為實證優化。

無模型檢查只能證明接口相容及指令是否保留邊界。後續真實效果需要另有目標、模型／provider、批次與 token 預算授權，在固定條件下觀察有依據的重做、無依據的重做、候選修訂原因、各角色成本與最終結果。不存在自動啟動或正式成功率門檻。

### 5.1 已定稿的最小實作範圍與行為判據

僅需修改 `product/opencode/agents/coordinator.md` 與 `product/opencode/agents/verifier.md` 的相關指令段；本切片不擴展 Engineer／Solver／Recon、Skill、schema、runtime 或測試。實作與驗收結果見 §7。

- **Coordinator：** 讀回指定 version／result 的完整報告，區分原 judgment、effectiveJudgment 和實際 blocker；轉交具體未解事實與本輪差量，分清包／來源缺口與報告比較接線。不得把推測的原因寫成 host 結論，亦不得指示把 equality 日誌當 candidate bytes。沒有包證據錯誤就不要求重包；未知傳輸按既有停止邊界處理。新 execution 所需準備和獨立驗證不因局部修正而省略。
- **Verifier：** recompute comparison 指向本 execution 綁定的必要 job evidence 中，**從獨立重算所產生的候選 bytes** 的確切半開區間（座標相對於該已選 evidence bytes），不是含 equality／hash／長度的摘要區間。先核對選區長度及 raw bytes；不得直接 echo prepared candidate 來充當重算，獨立來源與資料流、必要前提仍須支持語義判斷。報告降級而未取得具體 blocker 時，交回結果索引與未知，不猜測清空 premises／issues、不以再次 prepare 重置 execution 或重登記衝突報告。

可核對行為：分派內容能追到完整報告的實際 blocker；接手者只修已定位問題、保留未知與必要驗證；同版報告的 comparison 選區有獨立重算來源而非 candidate 回顯；跨 execution 重新 prepare；缺證據時仍可 inconclusive。上述是待實作與後續檢查的判據，**不是本次已驗證的新產品行為**。本次沒有證明節省 token 或提高成功率，後續真跑仍須另有明確預算授權。

## 6. 本次核對收口

本次由獨立分析會話在 `/Users/caihaoming/.codex/worktrees/handoff-offline-audit/pentest-agent` 執行，主會話核對同版 comparison 的實際選區長度／相等性與兩次修正 task 的指示，再整合回主區。獨立復核另核對四份報告 metadata、四次發布、關鍵 task 指示、比較實作和 execution 綁定，未發現阻斷問題；未重新逐項審核 Engineer 全部分頁讀取或最後重算的語義充分性，不冒稱完整重放。

長期結論已回寫本文，核心 design v1 同步狀態，已完成的一次性離線驗證 plan 刪除。產品角色／Skill／runtime／tests 未修改；未運行測試、build 或 typecheck，因本輪只有離線分析與文檔變更。沒有真實模型／Docker／題目執行、commit 或 push；本輪模型 run usage 為 unavailable。下一步只需根據 §5.1 另拆聚焦的角色指令實作 plan，本輪不自動實作。

## 7. 2026-10-24 最小角色指令實作

在 `87a94134572430d3def1f22bca799b4e52b511cb` 加當前 dirty 基線上，由 GPT 6.1 Sol 獨立子會話完成，主會話逐檔核對差量並整合。僅修改 Coordinator 與 Verifier：完整讀回實際 blocker 後交付修正差量，區分包缺口與比較接線；comparison 選當前 execution 必需 job evidence 中獨立重算的候選 raw bytes，半開座標相對選中 evidence。降級原因未知時交回 result 與未知，不清空前提、不重登記衝突報告。跨 execution 準備、獨立來源、必要前提、unknown 與可信完成邊界保留。

獨立靜態復核通過，對照 `verification-results.ts`、包準備與 execution 綁定實作，未發現阻斷。無模型驗證：`env -u D_RESULT_EVIDENCE_DIR -u D_VERIFIER_EVIDENCE_DIR npx --no-install vitest run tests/contract/d-verifier-handoff.test.ts tests/contract/d-verification-result.test.ts tests/contract/opencode-config.test.ts tests/contract/opencode.test.ts --cache=false`，4 檔／39 項通過，exit 0；`git diff --check` 通過。未新增測試或 gate。本輪只有角色 Markdown 差量，未重跑全套、typecheck 或 build；未跑真實模型／Docker，未 commit／push。

上述驗證確認指令與接口一致，不證明模型遵循、重算語義充分性、節省 token 或成功率提升。§6 保留為前次離線核對歷史；原始錯誤與未定稿一般交接建議不改寫為已驗證能力。一次性實作交接結論已轉入本節。

收口：實作子會話 `01a16dbe-af95-7b41-83e6-8f313ea9af4f` 已歸檔，專用 `bf13` 工作樹在差量整合與副本核對後已移除；未使用會建立 Git 快照提交的歸檔工作樹操作。其他既有工作樹保留，一次性實作 plan 已刪除。
