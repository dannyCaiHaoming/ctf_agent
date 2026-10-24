# design v1 B 詳細 design：Skill 找得到、用得對

記錄日期：2026-10-24（Asia/Tokyo）。

**狀態：2026-10-24 離線核對完成，選定 A（單一入口與條件分區），A 已實作為 Skill v4，獨立復核及主會話整合完成；模型選擇效果仍未驗證。** 本文是 [核心設計 v1](2026-10-22-ctf-agent-design-v1.md) §2 B 的詳細子文件。沿用 [A／B 資產設計](2026-10-22-design-v1-ab-product-assets.md) 的原生發現、按需載入、固定副本與受控讀取，不另建知識路由系統。

## 1. 目的與邊界

先讓現有方法可從名稱／description 被適當識別，載入後能根據前提選用相關方法、讀取需要的 Reference 並解釋結果；再依實際缺口決定是否擴數量。不是增加 Skill 載入率、強制每題調用 Skill 或新增漏洞百科。

本切片不改模型、工具權限、公共搜尋／依賴安裝限制、候選驗證標準，不新增角色、檢索服務、Schema、Hook、fixture 或 gate。不執行前一份交接 design 的 Coordinator／Verifier 優化，也不把兩項變更混為一批效果證據。真實模型 run、commit／push 未獲本輪授權。

## 2. 已知事實與未知

核對基線：`87a94134` 加當前未提交工作。產品只有一個 Skill `web-session-diagnosis` 及附屬 `source-version-and-behavior-comparison.md`；離線核對時 Skill 文檔版本為 3，已完成舊接口清理；後續 v4 實作見 §8。

- `apps/launcher/src/launch.ts` 驗證 Skill frontmatter 名稱／描述及目錄名，將正文和附屬檔案複製到 run 的配置目錄，保存副本記錄；原生 inventory 與正文使用不是同一回事。
- 當前產品配置允許各角色原生 skill／read；control-service 的 read 經 realpath 限制在該 run Skill 根內，題目資料仍走受管工具。不能把舊 A／B 文件中的「插件尚待放行」敘述當成當前缺陷。
- 既有 A／B 設計記錄固定版本 OpenCode 的無模型 skill → read 成功及 rg 條件；部分早期原始證據未保留。這支持歷史連通性記錄，不證明目前所有環境或真實模型會選對方法。
- `d-e2e-mfw-20261024-b2-1/evidence/inventory.json` 列有產品 Skill 和宿主內建 `customize-opencode`；逐消息 tool parts 中原生 skill 呼叫為 0，三次原生 read 均 error，且不是 Skill／Reference 路徑。本次只查 metadata、工具名稱／狀態／路徑分類，沒有讀 reasoning parts。
- 上述 run 早於當前 v3 清理，不能當成 v3 的行為測試。inventory 已列出也不證明每個角色每次請求的模型可見工具描述，零呼叫不證明工具失效、描述是唯一原因或本題必須使用該方法。
- 當前 description 只提 login、account state、CSRF、依賴前次請求的響應；正文另一段則適用於供給的源碼、歷史／版本、修復和前後端路由線索。這是可觀察的入口與正文範圍差異；是否造成漏選仍待驗證。

外部證據位置：`~/Documents/pentest-agent-run-data/d-e2e-mfw-20261024-b2/runs/d-e2e-mfw-20261024-b2-1/evidence/`。不複製候選、題目解法或完整消息到 repo，不從成功題目反向製作專屬觸發詞。

## 3. 要回答的問題

1. 發現到的是否為本 run 固定副本，名稱、description、附屬路徑與產品版本是否一致？現有證據能支持到哪一層？
2. 只看到名稱／description，是否能識別正文已支持的會話診斷與源碼／行為對照需求？是否會誤引純離線計算、沒有相關材料的題目？
3. 載入後是否清楚哪些章節有條件適用，避免無登入題仍照做登入檢查，或沒有源碼／歷史時虛構版本差異？
4. Reference 是按問題讀取，還是要求每次全讀？工具或材料不足時是否保留限制，而不是擴 scope 或把 Skill 當可信證據？

## 4. 方案比較與決策

| 方案 | 優點與代價 | 條件 |
| --- | --- | --- |
| A. 保留一個 Skill，調整 description 及正文適用分區 | 改動小、保留現有名稱和路徑；但名稱仍偏會話，描述過寬會誤選 | 已選定；以具體觸發條件覆蓋既有內容，最小範圍見 §7.4 |
| B. 拆出源碼／運行行為對照 Skill | 發現入口更聚焦；增加資產、Reference 歸屬與維護 | 延後；本次未證明 A 無法澄清入口，不因增加數量而拆分 |
| C. 增加短的角色使用提醒 | 可提醒有方法需求時檢查原生可用 Skill；重複提醒可能增加噪音 | 本次不採用；尚無角色責任或使用位置缺口的證據 |
| D. 全文預載／固定每題必用／自動路由 | 易使表面載入率上升，但失去按需性與自主判斷 | 不採用；不恢復已退場做法 |

離線核對先定稿最小修改範圍，後續實作見 §8；不移動 Reference、不新建 Skill。核對區分資產／接口缺陷、可發現性、適用性判斷、方法執行與無需調用五類原因。

## 5. 「用得對」的內容約定

Skill 應使讀者能辨認適用症狀、必要前提、相關最小檢查、結果解釋和換路條件；無需增加固定欄位或每題完整檢查表。方法只在實際觀察支持的問題上使用，缺材料時記未知，不按題型名稱機械選法。

具體接口用法與權限以當前工具為準；角色負責交接及驗證責任；Skill 保留方法；Reference 保留知識來源、版本與適用限制。現有源碼 Reference 可在已提供材料與觀察需要對照時讀取，不要求先讀全部知識。Skill 文本、Reference 和模型判斷均不能替代目標證據或宿主結果。

不以「已載入」作正確使用證明。若有後續獲授權真跑，應從必要工具與最終交付中觀察：是否建立前提、選擇可區分假設的實驗、根據反證修正，以及所得結論是否被證據支持；不需要保存私有推理或新增評分 agent。

## 6. 離線驗證與結果去向

本輪核對既有 assets／inventory／必要消息 metadata、當前原生工具准入與 Skill／Reference 內容。使用通用情境比較適用性：有登入但狀態不明、已有源碼但無登入、有版本標籤但缺歷史、響應只讀到預覽／已截斷、純離線計算且無 Web 狀態；這些是設計審閱問題，不新增 fixture，不向產品模型發送，不作模型選擇測試。

結果見 §7，包括最小對照：每個問題已知的入口資訊、正文適用段、前提缺口、應讀 Reference 或應不使用的理由。按 §4 選定 A，修改檔與行為判據見 §7.4；不能定位的模型選用原因保留未知。若原生發現／讀取確有問題，先用既有測試或無模型連通路徑定位，不用加長提示詞替代接口修復。

本次離線核對支持歷史 inventory 與固定副本一致、當前讀取准入的靜態分析，以及描述與正文的適用邊界；無法證明模型實際選擇、方法質量或成本改善。真跑仍須另有目標、模型／provider、批次與 token 預算授權；缺少 skill 調用的單次成功 run 不構成新增知識庫的理由。

## 7. 2026-10-24 離線核對結果

### 7.1 基線與可回查證據

本次基線為 `87a94134572430d3def1f22bca799b4e52b511cb` 加主工作區當時未提交的相關產品／launcher／plugin 文本。獨立工作區為 `/Users/caihaoming/.codex/worktrees/skill-offline-audit/pentest-agent`；主工作區只讀。核對對象是當前 v3，不以 HEAD 中舊資產代替。以下相對代碼路徑均指此基線；本次未運行 launcher、Docker、provider 或測試。

外部 run 根目錄為 `/Users/caihaoming/Documents/pentest-agent-run-data/d-e2e-mfw-20261024-b2/runs/d-e2e-mfw-20261024-b2-1`（下稱 R）。只取 `R/evidence/assets.json` 的產品版本與本 Skill 兩條 copies、`R/evidence/inventory.json` 的 Skill 記錄及兩個產品固定副本；未讀運行配置、reasoning、候選或題目材料。assets 記錄的來源版本為 `73e4121fc5669c3d15512af52ed26a6a258c418b`、`productDirty: true`，不是當前 v3。

| 對象 | 可回查位置 | SHA-256 與觀察 |
| --- | --- | --- |
| run Skill | `R/opencode/config/opencode/skills/web-session-diagnosis/SKILL.md`；`assets.json` 中同 path 的 copies 項 | `f3a047125a89430c3c93468aa54256afce1017cd148996ccc619409064fac71e`；重算實檔與記錄一致，正文 Version 2 |
| 當前 Skill | `product/skills/web-session-diagnosis/SKILL.md` | `25449f1daff101631086263a72fe4fc201a490919f4d6552d203a511fabcca46`；Version 3，與 run 不同 |
| run Reference | 上述 run Skill 目錄下 `references/source-version-and-behavior-comparison.md`；`assets.json` 中同 path 的 copies 項 | `80ead0af4b63b90523acf250efbe8d68c33ada1500fc3b89b05bf4b8733a6d90`；重算實檔與記錄一致 |
| 當前 Reference | `product/skills/web-session-diagnosis/references/source-version-and-behavior-comparison.md` | 同上，與 run 副本 bytes 一致 |

`inventory.json` 中 `web-session-diagnosis.location` 精確指向上述 run 固定副本，name／description 與其 frontmatter 一致；content 去首尾空白後與副本移除 frontmatter 的正文一致。整檔比較會因 frontmatter 不在 content 內而不同，這不是資產漂移。inventory 另列宿主內建 `customize-opencode`，不屬本產品方法資產。

證據分層：這些觀察支持「當時原生 inventory 發現該 run 的固定 v2 資產」。SDK inventory 返回正文不等於正文已注入模型，也不證明每角色每次請求看見的工具描述。§2 已有的零 skill 呼叫及三次非 Skill 路徑 read error 記錄本次未重新全量統計；不能據此確認原生載入、Reference 讀取或方法執行，更不能定位漏選原因。歷史 A／B §5 的 OpenCode 1.19.3、PATH ripgrep 15.2.0、確定性替身連通記錄仍只支持其條件下的 skill → read；本次沒有重新驗證當前環境連通性。

### 7.2 當前入口與准入

- `apps/launcher/src/launch.ts` 的 `collectLayer`（91–100 行）驗證 name／description 與目錄同名；166–190 行複製整個 Skill 目錄並記錄 bytes hash；239–241 行用 `client.app.skills` 寫 inventory；344 行保存 assets。不能以歷史來源 commit 單獨代表 dirty 產品內容，副本 hash 才綁定本次內容。
- `product/opencode/opencode.json` 的九個產品角色全部明確 `skill: allow`、`read: allow`。`apps/opencode-plugin/src/index.ts:131` 將原生工具准入送 control-service；`apps/launcher/src/control-service.ts:29` 為所有產品 ROLES 放行 skill/read，222 行先檢查 read 路徑，`toolBefore` 498 行再核對角色，`checkReadPath` 869–878 行經 realpath 限制在 run Skill 根內。相對 Reference 路徑不是相對 Skill 自動解析：模型應使用原生 skill 返回的附屬絕對路徑，不能直接把 repo 相對鏈接當作工作目錄路徑。
- 只有 Recon／Domain Solver 有普通 HTTP；其他角色能查閱方法不等於可執行全部方法。Reference 角色只查離線知識，Engineer／Verifier 也不能依 Skill 增添 HTTP 或材料權限。題目資料走受管 workspace／artifact 等接口；本次沒有發現需要新增工具、權限或路由才能完成此文字修正的證據。
- `product/opencode/agents/domain-solver.md:12` 已提醒按需原生 skill；`product/AGENTS.md` 已分開角色、方法與知識；Reference 角色已要求來源、適用與不適用條件。Recon 沒有同一句提醒不等於無法發現工具。沒有證據支持以全部角色加提醒修復漏選。

### 7.3 五個通用情境的靜態適用性對照

以下是人工作文檔審閱，並非送入模型的案例或行為結果。

| 情境 | 只看現有入口 | 已有正文適用段／前提缺口 | Reference 與應用邊界 |
| --- | --- | --- | --- |
| 有登入但狀態不明 | description 已明確覆蓋 | Minimal checks、Interpret results；需真實受保護路由和狀態觀察，Set-Cookie／200 不能證明登入；共享 cookie jar 不能當兩個獨立會話 | 不必因登入自動讀源碼 Reference；有實際源碼／路由對照問題才讀。缺匿名基線保留未知 |
| 已有源碼但無登入 | 名稱與 description 均偏會話，沒有直接提示源碼／行為比較 | Follow challenge clues 已適用；不應先完成 login 檢查。需區分所供 snapshot 與部署版本，缺 handler 不臆造 | 有來源與行為對照問題時按需讀 Reference；不強制有歷史才能分析單一 snapshot |
| 有版本標籤但缺歷史 | description 沒有版本線索入口 | Follow challenge clues 可處理材料盤點；標籤不足以確定內容、變更或部署版本 | Reference §1／Evidence limits 可解釋限制；無兩個版本或歷史不得聲稱修復差異，不外搜補材料 |
| 響應只有預覽／已截斷 | description 只有「依賴前次請求」條件，未覆蓋獨立的響應完整性問題 | Check response continuation 已明確區分 preview、已存 bodyBytes、bodyTruncated；截斷原文不能從讀完 bodyPath 恢復 | 不因截斷自動讀源碼 Reference；讀所需保存 bytes，缺尾保留未知，新請求是新觀察。無登入也適用 |
| 純離線計算且無 Web 狀態 | 現有 Web／會話限定不應選用 | 不以通用「解題／交接」段把整個 Skill 擴成任何題必用；無 Web 行為、源碼行為對照或 HTTP 響應問題即無本方法需求 | 不載入此 Skill／Reference；原有角色和受管計算工具處理。純粹有版本字串也不構成適用 |

### 7.4 選定 A；B、C 不納入本次最小修改

**A 定稿的最小實作範圍：只改 `product/skills/web-session-diagnosis/SKILL.md`。** 保留原 name、目錄、Reference 路徑和現有方法，不新增知識內容。description 與開頭適用說明須涵蓋三種有條件的 Web 需求：登入／會話狀態；已提供源碼、路由或版本材料與觀察行為的對照；HTTP 響應完整性或業務後置條件。名稱雖偏會話，精簡 description 可以補足已存在的兩類入口；目前沒有靜態證據證明一定需要拆檔。

將現有 Minimal checks 明確標為會話診斷分區，避免全體讀者先做登入步驟；其中通用「先讀供給材料」的檢查移到共同的適用前提或材料分區，其餘 login／cookie 比較留在會話段。保留源碼與響應段各自觸發條件、角色權限、未知與換路規則。Reference 維持按需：當源碼／版本與行為需要對照時，經原生 skill 返回路徑讀取；不可用則記限制。增加簡短不適用條件即可，不新增固定全題檢查表。除被改寫取代的狹窄入口句外，不刪除既有方法或 Reference；交接段的精簡／遷移屬另一切片，本次不改。

**B 延後：** 兩種方法可各自使用，但這只滿足拆分的必要條件之一；未證明用條件分區和描述無法澄清入口。現在拆分會增加發布及 Reference 歸屬成本，沒有對應的已證實收益。**C 不採用：** 已有 Solver 按需提醒與共用責任邊界；缺乏角色未看見／不知道使用位置的證據。其他角色未重複提醒與零調用都不能單獨證成新增提醒。D 維持拒絕。

實作驗收只要求上述五情境的描述與正文一致、無登入者不被要求登入、沒有歷史者不被要求構造差異、預覽與截斷不混為一談、純離線計算不被泛化納入；保留所有實際角色／scope／Reference 路徑限制。文檔鏈接及差異核對即可，不新增逐字測試或 gate。此結論不表示提升模型選擇率、解題能力或成本；這些仍未知，後續真跑需另有明確授權。離線核對階段只完成設計核對；其後 A 的實作結果見 §8。

### 7.5 復核與收口

獨立只讀復核未發現阻斷問題；主會話另核對固定副本 hash、版本差異與描述，並整合核心設計引用。結論已轉入本文，一次性離線驗證交接文件移除。只做文檔鏈接、差異與改動歸屬檢查；本輪未改產品，未執行 npm tests／typecheck／build 或當前 runtime 連通測試，未跑真實模型，未 commit／push。

## 8. 2026-10-24 A 方案實作與復核

以 `87a94134572430d3def1f22bca799b4e52b511cb` 加當前 dirty 工作檔及已整合角色修正為基線，由第二個 GPT 6.1 Sol 獨立子會話執行。唯一產品差量是既有 `product/skills/web-session-diagnosis/SKILL.md`，文檔版本 3 → 4；SHA-256 為 `b2f2aebe465511fc855b3512407762a07e74ca08d05536b7c490b7d34fde4b8f`。name、目錄及 Reference 保持不變。

description 與開頭呈現會話、供給源碼／路由／版本與行為對照、HTTP 響應完整性／業務後置條件三種需求。原供給材料檢查移至共同前提，登入檢查明確限定會話問題，響應檢查無需先登入；Reference 按需使用原生返回路徑，缺歷史不虛構版本差異，純離線計算排除。原方法、交接、解釋、換路及權限／scope 邊界保留，沒有新增方法或資產。

五情境靜態對照通過；獨立最終復核另對照三份產品指令及實際比較接口，未發現衝突或阻斷。`quick_validate.py` 因缺 PyYAML 退出 1，未安裝依賴；改用既有 Node YAML 庫解析 frontmatter，name／description、Reference 鏈接和方法保留核對通過。主會話另核對 YAML、鏈接、未改的交接／結果解釋／換路段；`git diff --check` 通過。沒有將替代檢查說成原驗證器通過。

本項不跑全文逐字測試、全套 tests／typecheck／build 或 runtime 連通測試。前一角色切片的 39 項 contract 通過屬其接口回歸，不算 Skill 模型行為證據。未跑真實模型／Docker／題目，未 commit／push；原生載入、實際選用、解題效果與成本改善仍未驗證。一次性實作交接結論已轉入本文。

收口：實作子會話 `01a16dc2-b657-7e81-8ad6-cc992541c346` 已歸檔，專用 `1aff` 工作樹在差量整合與副本核對後已移除；未使用會建立 Git 快照提交的歸檔工作樹操作。其他既有工作樹保留，一次性實作 plan 已刪除。
