# 開源 CTF 解題 agent 的方法知識組織：文獻調研（2026-11-12，第二批 2026-11-19）

**性質：** 工程模式的文獻調研。只讀公開網頁、倉庫 README／摘要頁與 GitHub API 的 license／star 元資料，不 clone、不執行、不連任何目標。只記錄結構、分類、觸發方式、評測結論與 license，不摘抄 payload、exploit 或題解。
**存取日期：** 第 1 至 6 節為 2026-11-12 存取；第 7 節及其後的修訂為 2026-11-19 存取，除另註外。
**資料可靠度：** 倉庫內容經 WebFetch 的摘要模型轉述，論文數字取自摘要頁或同一來源；引用進 design 前應回原文核對。第二批各節標明核對層級：讀過 README／摘要，或只核對倉庫描述與 license。以下「未查到」處已明寫，未用其他說法繞過。

## 0. 調研範圍與未查到項

| 項目 | 狀態 |
|---|---|
| EnIGMA／SWE-agent | 已查（論文 HTML 前 100K 字；後 80K 字附錄未讀）。倉庫的 `config`／`tools` 內容頁只見目錄名，未見內容 |
| NYU CTF agents／D-CIPHER | 已查 README 與 D-CIPHER 消融摘要；prompt 與知識組織方式 README 未說明，未讀代碼 |
| PentestGPT | 已查 README 與 2023 論文；新版 `pentestgpt_agent`／`unified_agent` 內部結構未查到 |
| Cybench | 已查 README 與論文前 100K 字；agent 提示詞措辭未查到 |
| CAI | 已查 README；CTF 知識如何組織 README 未描述 |
| Claude Code／OpenCode CTF skill 倉庫 | 第 1 批查 ljagiello、naravid19、hatrickkkk；第 2 批另查 VulnClaw、pentestagent、pentest-ai-agents，未逐一查其他 fork |
| 第二批：VulnClaw、pentestagent、pentest-ai-agents、hackingBuddyGPT、VulnBot、HackSynth | 已讀 README（2026-11-19） |
| 第二批：CTFJudge／CCI／CTFTiny、CyberGym | 已讀論文摘要頁與 CTFTiny README；正文數字未讀 |
| 第二批：Pentest-Swarm-AI、BoxPwnr | 只核對倉庫描述、license 與活躍度，README 未讀 |
| 第二批：其他 skill 集合（SecSkills、AboutSecurity、ctf-super-hub） | 只核對倉庫描述與 license，未讀內容 |
| 第二批：騰訊雲智能滲透黑客松（TSec） | 已讀官方 README、賽事 API／MCP 文檔與部分團隊 README；決賽 PPT 未讀 |
| 第二批：AIxCC CRS | 只核對倉庫描述與 license，README 未讀 |
| 同名混淆：ctfbench.com | 查證後排除：智能合約審計 benchmark，與 CTF 無關 |
| 搜尋或抓取被安全機制中止 | 兩批都沒有發生 |

## 1. EnIGMA（SWE-agent 的 CTF 模式）

- **來源：** 論文 <https://arxiv.org/html/2409.16165v3>（v3, 2025-06）；倉庫 <https://github.com/SWE-agent/SWE-agent>（EnIGMA 為其中一個模式，頁面建議用 0.7 版）。
- **License：** MIT（SWE-agent 倉庫）。
- **知識分類維度：** 按題型。論文原話是每個題目類別有不同的 demonstration 與 guideline；guideline 由作者看開發集失敗軌跡後寫成。
- **載入方式：** 論文頁面未說明是否常駐，從設計看屬於 prompt 內常駐（demonstration 與 guideline 按類別選入 system／初始 prompt），不是按需檢索。這一點屬推斷。
- **reference 分層：** 以「ACI」為核心：每個新增交互工具（debugger、遠端連線）帶簡單動作、文檔、guideline、demonstration、執行回饋；工具文檔另有附錄表。長輸出由 summarizer 處理（寫檔後開窗口，或由另一個 LM 按題目語境壓縮）。沒有 payload 庫。
- **消融數據（Claude 3.5 Sonnet，pass@1，四個 benchmark 合計）：**

| 配置 | 解題率 | 相對完整版 |
|---|---|---|
| 完整 EnIGMA | 29.5% | — |
| 去掉交互工具 | 27.4% | −2.1 |
| 簡單 summarizer | 26.9% | −2.6 |
| 無 summarizer | 28.2% | −1.3 |
| 去掉 demonstration | 23.3% | −6.2 |

  細項：去掉工具後 crypto／pwn／rev 下降而 web 上升（作者歸因於缺少好的網頁導航界面）；有工具時平均 11.5 輪解出，無工具 14.9 輪；去掉 demonstration 後多數類別下降，web 與 misc 反而上升；簡單 summarizer 比不用還差，LM summarizer 優於不用。
- **啟示：** 跨類別看，**demonstration（帶試錯過程的範例）貢獻最大**，其次是互動工具與輸出摘要；知識的增益隨題型不均勻，web 類沒有跟著受益。這與本倉庫「缺口含輸出截斷」直接相關。

## 2. NYU CTF Bench 的 agent 與 D-CIPHER

- **來源：** 倉庫 <https://github.com/NYU-LLM-CTF/nyuctf_agents>；論文 <https://arxiv.org/pdf/2502.10931>；後續評論 CTFusion <https://arxiv.org/pdf/2605.11504>（以上為搜尋摘要，數字未回原文核對）。
- **License：** MIT。
- **結構：** `nyuctf_baseline/`（單 agent 基線）與 `nyuctf_multiagent/`（D-CIPHER：planner、executor、可選 auto-prompter），行為由 `configs/` 下 YAML 控制。README 沒有說明 prompt 或知識如何分類。
- **知識組織：** 不靠外置知識庫。auto-prompter 先探索題目、為 planner 產生初始 prompt，相當於「按題目現場生成一份方法提示」；planner 切分任務給 executor。
- **消融（NYU CTF Bench）：** 去掉 planner 成績下降 1–5 個百分點；去掉 auto-prompter 時 Claude 3.5 Sonnet 反而 19.0%→22.0%，原因集中在 pwn：auto-prompter 的初始發現有時有誤導，讓 planner 走向無效策略；其他組合（GPT-4o、Cybench 上的 Claude）去掉後下降。強弱模型混搭作 executor 一致較差。CTFusion 報告去污染後的 D-CIPHER 變體 9.7% 對原版 13.6%，作者暗示有題目污染。
- **啟示：** 「現場生成的方法提示」有雙面性：錯誤的初始結論會被後續角色當前提繼承。與本倉庫 Coordinator 交接的「未驗證前提需標來源」同向。

## 3. PentestGPT

- **來源：** 倉庫 <https://github.com/GreyDGL/PentestGPT>；論文 <https://arxiv.org/html/2308.06782>（USENIX Security 2024）。
- **License：** MIT（`LICENSE.md`）。
- **結構：** 舊版（現為 `pentestgpt_legacy`）三個模組：Reasoning（持久會話，維護任務樹 PTT 並選下一子任務）、Generation（每個子任務新開會話轉成具體操作）、Parsing（壓縮工具輸出、源碼、HTTP 回應）。PTT 是自然語言的分層列表，每次更新後有校驗：只允許葉節點變動，不合規送回模型修正。新版 v1.0 改為驅動 Claude Code／Codex 的管線（CTF：recon→exploit→walkthrough；pentest：資產發現→漏洞識別→報告），倉庫另有 `.agents/skills` 目錄，內容未查。
- **知識分類維度：** 按階段與狀態（任務樹），不按題型；方法知識主要在模型本身，樹只存「狀態與線索」。
- **消融（GPT-4，13 個目標 182 個子任務）：** 去掉 Reasoning 最差（只剩完整版子任務完成數的 53.6%，低於裸 GPT-4）；去掉 Parsing 只略降；去掉 Generation 略優於裸 GPT-4。作者報告子任務完成數較裸 GPT-4 多 58.6%。README 另引 2025-12 在 XBOW 驗證集 86.5%（90/104）的歷史結果，並聲明不代表當前產品。
- **啟示：** 有證據的增益來自「外顯狀態＋由它選下一步」，不是更多領域知識；輸出壓縮的貢獻較小。與 design §7／§8.1 的帳本方向一致。

## 4. Cybench

- **來源：** 倉庫 <https://github.com/andyzorigin/cybench>；論文 <https://arxiv.org/html/2408.08926>。
- **License：** Apache-2.0。
- **結構：** 倉庫分 `agent`、`benchmark`、`grading`、`analytics`、`tools`；有 unguided 與 subtask 兩種模式。agent 每輪輸出固定五欄（Reflection、Plan and Status、Thought、Log、Action），記憶只保留初始 prompt 加最近三組回應－觀察。
- **知識組織：** agent 不帶領域知識庫；結構化的是回應格式與（可選的）子任務分解。
- **評測：** subtask 引導對最終成功率的幫助不一致（Claude 3.5 Sonnet 17.5% unguided 對 15.0% guided；GPT-4o 12.5%→17.5%；Llama 3.1 405B 7.5%→15.0%；部分模型持平或更低），但分數化的子任務完成率遠高於二元結果，說明有進度而不一定到終點。unguided 時成功者幾乎都是首解時間 11 分鐘以內的題。四種 scaffold（structured bash、action-only、pseudoterminal、web search）的效果隨模型而異。
- **啟示：** 這與 design §7 引用的「Cybench 顯示子任務分解顯著提升」不符：論文數據說子任務引導的整體增益有限且模型相關。**design §7 該句應在下次修訂時更正為「增益不穩」。** 本倉庫 design 另有「按原文核對再補確」的條款，此處即是核對結果。

## 5. CAI（Alias Robotics）

- **來源：** <https://github.com/aliasrobotics/cai>（頁面已標為 archive）。
- **License：** 混合。`src/cai/agents` 為 MIT（源自 openai-agents-python），Alias 自有部分為僅限研究用的 Research-Use License；有 `LICENSE`、`LICENSE-MIT`。官網與 LICENSE 的說法不一致，以 LICENSE 為準，且我看到的是搜尋摘要中標為舊版的檔案，使用前需核對現行內容。
- **結構：** agents、handoffs、multi-agent patterns、MCP 工具、四層 prompt-injection guardrail、LiteLLM 模型路由、環境變量與 `agents.yml`。README 沒有描述 CTF 知識如何組織；只提到教學課程按 web／crypto／reverse／forensics 排列。
- **評測：** 全為廠商自報（無方法細節）：Neurogrid CTF 41/45 flag、Dragos OT CTF 32/34、Cybench 上多 scaffold 黑板 19/33 對最佳單 scaffold 15/33、G-CTR 博弈論引導把成功率 20%→43%。這些不是消融，不能說明哪類知識有用。
- **啟示：** 對方法知識分層沒有可借鑒的結構；只有「多 scaffold 共享黑板」與本倉庫 workbook（共享狀態）方向相近，證據弱。

## 6. 面向 Claude Code／OpenCode 的 CTF skill 倉庫

### 6.1 ljagiello/ctf-skills

- **來源：** <https://github.com/ljagiello/ctf-skills>、<https://github.com/ljagiello/ctf-skills/blob/main/ctf-web/SKILL.md>、<https://github.com/ljagiello/ctf-skills/tree/main/evals>。
- **License：** MIT。
- **分類維度：** 主軸按題型（13 個 skill：web、pwn、crypto、reverse、forensics、osint、malware、misc、ai-ml、writeup 等），另有 `solve-challenge` 作為入口分派。每個 skill 的 SKILL.md 本身混用三種維度：檔頭按「症狀→先讀哪個檔」的 Fast Pattern Map，主流程按階段（建圖、分類、最小驗證），支撐檔按技術族分組。
- **載入方式：** frontmatter 的 description 約 700 字元，是長關鍵字清單，含觸發條件、漏洞族與明確排除（指向其他 skill）；`user-invocable: false`（由模型按 description 匹配）；同時提供 `/solve-challenge` 手動入口。SKILL.md 約 245 行／17 KB，作為路由器，細節在約 20 個連結檔，屬漸進披露。
- **reference 分層：** SKILL.md（方法與路由，約占本體）＋技術筆記檔（大宗，ctf-web 23 檔、ctf-pwn 65 檔）＋可執行模板腳本＋ PayloadsAllTheThings 索引。**payload／技術條目占主體**，方法論只是檔頭的一小段。這正是本倉庫 design 劃在邊界外的那一類。
- **評測：** README 無成績聲明，但有 `evals/`（promptfoo）：**routing**（給題目描述，是否載入正確的 skill，不載入錯的；CI 門檻 90%）、**rules**（載入後是否遵守 8 條規則，每條有正例與陷阱反例）、**solve**（小型離線題在有無 skill 下的對比，只比較不擋 CI，flag 用 SHA-256 比對）。未公開任何通過率。
- **啟示：** 評測設計值得借鑑，而不是內容：把「觸發」與「遵守」與「解題」三個層次分開量。這回答了 design §8.2 的 L1／L2 分層，且可離線、廉價地做。

### 6.2 naravid19/claude-ctf-skills

- **來源：** <https://github.com/naravid19/claude-ctf-skills>。
- **License：** MIT（核心技術取自上游 ljagiello，同為 MIT）。
- **結構：** 9 個類別 skill＋ `solve-challenge`／`ctf-similar-search`（需外部搜尋 API）／`ctf-writeup` 三個工具型 skill；另有 `ctf-solver` 組長 subagent 與 8 個領域專家 subagent；腳本放在各 skill 的 `scripts/` 保持可攜。
- **載入方式：** 四條路徑：手動 triage 命令、直接叫組長 agent、直接叫專家、模型按 description 自動選。專家 subagent 的用意是把複雜工作移出主上下文。
- **reference 分層：** 以技術文檔為大宗（web 23、pwn 21、crypto 20、forensics 15），另含 pwnable.tw 題解 43 篇；腳本另列。題解與 payload 占比高。
- **評測：** 只有 122 條結構測試（frontmatter、agent 定義、腳本、連結），無解題或觸發數據；自報計數互相不一致，品質聲明未獨立驗證。
- **啟示：** 把「組長＋專家」做成常駐 subagent 是本倉庫已有的角色設計（Coordinator／Recon／Solver）的另一種拆法，沒有證據顯示更好。

### 6.3 hatrickkkk/ctf-claude

- **來源：** <https://github.com/hatrickkkk/ctf-claude>。
- **License：** 頁面未標示（按「無 license」處理，不借用內容）。
- **結構：** 9 個 skill，按攻擊領域與階段（recon、web、AD、ADCS、SQLi、BOF、Linux／Windows 提權、容器逃逸），每個是分階段檢查清單；`ctf-recon` 為入口，發現相關服務後自動連到專項 skill；依賴外部 Kali MCP 伺服器。
- **載入方式：** slash 命令為主（`/ctf-recon <目標>`），並可鏈式切換。
- **評測：** 無任何數據，0 star。
- **啟示：** 「入口 skill 識別後交接給專項」的鏈式結構與本倉庫 Recon→Solver 一致；階段檢查清單是它唯一的特色。

## 7. 第二批新增項目（存取 2026-11-19）

第二批只收對「方法知識如何組織、何時載入、如何驗證」有借鑑意義的項目；多數是通用滲透測試框架或競賽衍生項目，CTF 只是其中一個場景，範圍差異逐節標明。只核對描述與 license 的項目另註。搜尋以 GitHub API（ctf agent、ctf benchmark、ctf skills 等）與 web 搜尋交叉，入選標準是 README 或摘要對上述三者有具體描述。

### 7.1 VulnClaw

- **來源：** <https://github.com/Netw0rkNoob/VulnClaw>（MIT，3,945 star，2026-10-30 最後推送）。
- **結構：** 可獨立運行的 Python CLI／TUI／Web 工具。預設「模型主導」求解迴圈：只給目標、歷史、證據記憶與工具清單，由模型決定下一步；另有角色團隊模式與舊版固定輪數模式。工具以 MCP（fetch、memory、chrome-devtools、burp）混合內建工具（HTTP 批量探測、Python、shell、源碼還原、運行時差分探測、編解碼）。
- **知識分類：** 按題型與領域。README 稱 50 個 Skill，但其表格列出的核心 7 個加專項 16 個合計 23，計數不一致；以下按表格描述。核心 7 個為流程型（recon、漏洞發現、利用、後滲透、報告、WAF 繞過），專項 16 個含 web、android、客戶端逆向、內網、crypto 工具、ctf-web／crypto／misc、osint、CVE 分流，部分帶 `references/`（最多 40 檔）。
- **載入方式：** Skill 只以「參考資料索引」出現在上下文，正文需模型主動呼叫 `load_skill_reference` 讀取；README 明說不再把 Skill 正文或階段流程強制注入。這是「描述匹配」與「常駐索引」之外的第三種做法：索引常駐、正文按需。
- **狀態與證據：** `AgentState.evidence` 完整保存每次工具輸出原文（hash、大小、證據編號）；進入模型上下文的是有界的高信號預覽（狀態碼、請求面、表單與參數、endpoint、危險 sink、flag 樣式字串、行號、原文大小與 hash）；`evidence_search`／`evidence_view` 按需回查；相同輸出只留 `same_as=eXXX`；連續多輪只翻證據會觸發 stall guard。
- **驗證：** 「FINAL」的 flag 或結論必須在真實工具輸出中逐字出現，或顯式引用證據編號，否則拒絕並要求繼續；`NO_PATH` 同受此閘門約束，高信號錨點未耗盡時不接受提前停止。
- **評測：** README 無解題率，也未見 evals 相關說明，只有 CI／codecov 徽章；不能作效果證據。
- **啟示：** 目前最接近本倉庫「薄宿主＋共享證據＋Skill 索引」組合的公開實現。可借機制（證據兩層、顯式閘門、索引＋按需載入），不借內容：其 web 進階與知識庫文檔以技術條目為主，屬邊界外；且無評測數據。

### 7.2 hackingBuddyGPT

- **來源：** <https://github.com/ipa-lab/hackingBuddyGPT>（MIT，1,335 star，TU Wien IPA-Lab）。
- **結構：** 以 use-case 為單位，每個是 `wintermute` 子命令。兩種執行風格共用一個迴圈：原生 tool calling（保留真實對話歷史）與模板命令策略（每輪把歷史渲染進 prompt、解析一條命令）。連接器有 SSH、本地 tmux、psexec；LLM 經 litellm；含四種上限（輪數、token、金額、牆鐘時間）與 OpenTelemetry GenAI JSONL 痕跡，附 `log-view`／`log-analyze`（可輸出 LaTeX 表）。
- **知識組織：** 沒有中央知識庫；方法寫在各 use-case 的 prompt 模板與可選開關（hints、CoT、structured guidance、state tracking、`--rag_path`）。`ExPrivEscLinuxLSE` 先跑 `lse.sh` 列舉，再把輸出拆成提示逐項編排，是「列舉先行」的具體流程。
- **多角色：** `AD` 是 planner／executor：常駐策略 planner 維護任務樹與共享知識庫，把每個任務交給全新的、無記憶的 executor；`AdvancedWebTesting` 是無直接目標存取的上層 agent，委派給有界 sub-agent。
- **成功判定：** `MinimalToolCallPrivEscLinux` 的 `task_solved` 對照真實輸出驗證，模型自稱拿到 root 不能計成功。
- **評測：** 另有 Linux 提權 benchmark 倉庫；README 引 2023 論文比較多家 LLM，未給 CTF 數字。
- **啟示：** ① ground-truth 判定與「模型自述不能改成功狀態」同向，且是工具層機械比對；② planner 常駐、executor 無記憶，與 Coordinator→Solver 的交接形狀一致，支持狀態留在宿主；③ 四種上限與痕跡格式可對照預算與事後投影；④ 列舉先行支撐 §9.4 的特權 helper 缺口。

### 7.3 HackSynth

- **來源：** <https://github.com/aielte-research/HackSynth>（AGPL-3.0，324 star）；論文 <https://arxiv.org/abs/2412.01778>。
- **結構：** Planner＋Summarizer 雙模組，迭代產生命令並處理回饋；另建 PicoCTF 與 OverTheWire 兩套 benchmark，合計 200 題。
- **知識組織：** 不靠外部知識庫；Planner 決定下一步，Summarizer 壓縮回饋。摘要說分析 temperature／top-p 與 token 使用，GPT-4o 最好；未見兩模組各自的消融。
- **評測：** benchmark 公開；摘要只給模型比較與參數分析，沒有知識組織對照。
- **啟示：** 與 EnIGMA 同向，支持把輸出壓縮做成獨立角色或步驟；但 AGPL 且 benchmark 內含題目材料，只能外部對照，不併入產品資產。

### 7.4 pentestagent

- **來源：** <https://github.com/GH05TCREW/pentestagent>（MIT，3,310 star）。
- **結構：** Python TUI／CLI，四種模式（assist、agent、crew、interact）。`spawn_mcp_agent` 讓運行中的 agent 以 stdio 生成隔離子 agent（各自 runtime、LLM client、歷史、notes），再把子 agent 工具注入父層；另有 run_task／run_task_async／await_tasks／get_task_result／cancel_task 控制面；可作為 MCP server 對外提供任務介面。
- **知識與狀態：** `knowledge/sources/` 放方法論、CVE、wordlist 會自動注入上下文（RAG）；`loot/notes.json` 以 credential／vulnerability／finding／artifact 分類持久保存、跨會話注入；`crew` 模式把 notes 建成知識圖（README 稱 shadow graph），用來推導策略結論；工具超過 128 個時改用嵌入檢索的 `rag_optimizer` 取回相關工具。
- **評測：** README 無成績或消融。
- **啟示：** ① notes→知識圖與 workbook 假設圖同向，且是「宿主建圖、模型讀」；② 工具 RAG 是工具膨脹時的處理方式，目前本倉庫未到需要；③ 子 agent 經 MCP 生成屬另一套多 agent 機制，不照搬；④ 方法論／CVE／wordlist 自動注入落在邊界外。

### 7.5 pentest-ai-agents

- **來源：** <https://github.com/0xSteph/pentest-ai-agents>（MIT，2,462 star）。
- **結構：** 50 個 Claude Code subagent（README 另處寫 52，計數不一致），markdown＋YAML frontmatter，按 description 路由；分 Tier 1 顧問型與 Tier 2 可執行型，後者須帶 scope guard、逐命令確認。另有 findings SQLite（init／stats／list／export）與 `handoff.sh` 產生跨會話交接報告；lite 模式把顧問型換成較便宜模型；內含 `ctf-solver`。
- **知識組織：** 全寫在各 agent 的 prompt，按領域切分；另追蹤 80+ 外部工具。
- **評測：** CI 只驗 frontmatter、scope guard 是否存在、plugin manifest 與安裝腳本，不解題、不量觸發；無路由或解題數據。
- **啟示：** ① 顧問／可執行分層與逐命令確認可對照角色准入；② findings DB＋handoff 與 workbook／交接同向；③ 便宜模型跑顧問型角色與現行模型分工一致；④ 50 個 agent 靠 description 路由，正是 design §8.2 要分辨的觸發問題，但同樣無數據。

### 7.6 VulnBot 與 Pentest-Swarm-AI（只核對描述）

- **VulnBot：** <https://github.com/KHenryAegis/VulnBot>（MIT，236 star）；多 agent 協作＋RAG（Milvus／Langchain-Chatchat），`enable_rag` 開關；README 只有安裝步驟，未說明知識分類，也無評測；論文 <https://arxiv.org/abs/2501.13411>。
- **Pentest-Swarm-AI：** <https://github.com/Armur-Ai/Pentest-Swarm-AI>（AGPL-3.0，3,263 star）；Go 實作，協調 recon／分類／利用／報告專家，支援 CTF 模式；只核對倉庫描述與 license，README 未讀。
- **其他 skill 集合（只核對描述）：** DaoYiSec/SecSkills（Apache-2.0）、wgpsec/AboutSecurity（未標示 license）、asdfgh1445/ctf-super-hub（未偵測到 license）；後兩者不借用內容。
- **啟示：** 兩者都無可用的組織或評測細節；AGPL 也限制代碼借用。RAG 類做法在本次調研仍無消融證據。

### 7.7 評測：部分正確性與規模化

- **CTFJudge／CCI／CTFTiny：** 論文 <https://ojs.aaai.org/index.php/AAAI/article/view/40210>（AAAI-26，NYU 等）。CTFJudge 用 LLM 當判官，按解題步驟給分；CCI 是相對人工標準答案的部分正確性指標；CTFTiny 是 50 題快速集（pwn、web、rev、forensics、crypto），沿用 NYU CTF Bench 結構。官方倉庫 <https://github.com/NYU-LLM-CTF/CTFTiny>（GPL-2.0）與 <https://github.com/NYU-LLM-CTF/CTFJudge>（未標 license）。摘要另稱比較 temperature／top-p／最大 token 與多 agent 協作設定，正文數字未讀。
- **CyberGym：** <https://arxiv.org/abs/2506.02548>、<https://github.com/sunblaze-ucb/cybergym>（Apache-2.0）。1,507 個真實漏洞、188 個專案；任務是依描述與代碼庫產生可重現 PoC；摘要稱最佳組合成功率約 20%，發現 34 個 zero-day 與 18 個不完整修補。它批評小規模、只看靜態結果的評測，與本倉庫只量是否解出的局限同向。
- **BoxPwnr：** <https://github.com/0ca/BoxPwnr>（AGPL-3.0，471 star），跨 HackTheBox、TryHackMe、PortSwigger、Cybench、picoCTF 的評測框架；另有公開解題痕跡 <https://github.com/0ca/BoxPwnr-Traces>。README 未讀。
- **同名排除：** <https://github.com/ctfbench/ctfbench>（ctfbench.com，Apache-2.0）是智能合約審計 benchmark（VDR／OI 指標），與 CTF 無關，勿因名稱誤引。
- **查而未入選：** AutoPenBench（MIT，112 star，只核對描述，偏一般滲透測試任務集）；Awesome-Offensive-AI-Agentic-Landscape（MIT，485 star，清單型索引，非方法組織）。兩者對本題沒有新增可借點。

### 7.8 競賽產物：騰訊雲智能滲透黑客松

- **來源：** <https://github.com/Yeti-791/Tsec-Hackathon>（官方資源倉，890 star，未標示 license）。收兩屆前 20 名團隊的開源導航、決賽 PPT 與賽事接口文檔；另連結 <https://github.com/Yeti-791/Awesome-Offensive-AI-Agentic-Landscape>（MIT）的全景清單。以下只讀公開 README／文檔，未讀 PPT 與實作。
- **賽事接口（第二屆）：** 同一組能力有 HTTP API 與 MCP 兩種接入：查賽題、啟停實例、提交 flag、查看提示。限制為每隊每秒 3 次、同時最多 3 個實例、提示首次查看扣該題 10%；關卡按已解數量解鎖，一題可有多個 flag。參賽者復盤另述計分按提交時名次衰減（第 1 名 +20%，第 11 名後 −10%，第 31 名後 −80%），提交即鎖分。
- **可借點：** 這是「平台判定 solved、部分分、時間敏感」的具體樣本；接口可對照 E 的取題與 C 的准入。TSecBench 不在當前執行範圍，本節只記錄公開資料，未據此啟動任何 run。

#### BreachWeave（Apache-2.0，770 star，第二屆第 1／613）

- Manager／Solver／Observer：Manager 管節奏、分配與回收 Solver、彙總狀態；Solver 執行；Observer 旁路監督，只檢查最近幾輪軌跡的偏移、狀態混雜、過早結束與上下文膨脹，做輕量糾偏，不接管執行。
- 狀態分層：Idea 存「值得推進的方向」，Memory 存「可複用的事實、證據與約束」。
- 結束條件外置：由系統結合任務狀態統一約束，不交給模型主觀判斷。官方摘要另稱 RTK Rewrite 三層壓縮與 Ralph-Loop 狀態約束。
- 多 Solver 並行探索，Manager 避免重複試錯。
- 評測：只有競賽名次（線上 1/613、決賽一等獎），README 未見消融。

#### Cairn（AGPL-3.0，5,382 star，第二屆第 3，唯一 AK）

- 把滲透看成狀態空間的有向搜尋：origin 已知、goal 明確、路徑未知；黑板架構只有三種原語：Fact（已確認事實）、Intent（待探索方向）、Hint（人類判斷）。
- Worker 跑 OODA，無固定角色；任務由圖的當前狀態生成；只透過共享黑板協調（stigmergy），不直接通訊。Server 只管圖一致性，Dispatcher 調度任務與容器，是協議的唯一寫者。
- 評測：競賽唯一 AK；README 未見消融。AGPL，只取想法。
- 對照：這是「無角色、共享圖」的極端做法，與本倉庫固定角色相反；單一賽事不足以推翻現有設計，但說明角色分工不是解題的必要條件。

#### CyberStrikeAI（Apache-2.0，8,834 star，第一屆第 17）

- Go 平台：Pi 編排（單 agent、Deep、Plan-Execute、Supervisor 四種）；圖工作流把 agent、工具、條件、審批與輸出串成可重用流程；角色化測試帶各自的工具策略；100+ YAML 工具配方；MCP 支援 HTTP／stdio／SSE／聯邦；知識庫做查詢改寫、向量檢索與重排；Skills 漸進按需載入。
- 工具執行韌性：worker 隔離、有界等待、可續接的 `execution_id` 輪詢、取消、per-server circuit breaker、併發上限與統一輸出上限。
- 評測：README 無成績。
- 可借：統一輸出上限、可續接輪詢、角色工具策略、漸進 Skill 載入都與本倉庫缺口重合；但整體是重型平台，不照搬。

#### 其他參賽項目（簡述）

- **aide-for-pentest**（未標示 license，第二屆第 7，50/54）：通用 runtime＋場景 overlay；「Less Than Nothing」把零領域知識當主動排除；coordinator＋ant／explorer／ralph 三類 worker。與本倉庫 Skill 內容方向相反，作為對照。
- **tinyctfer**（未標示 license，第一屆第 4）：約百行、Claude Code subagent、meta-tooling；比賽版另有任務排序、失敗後提示詞變換與 hint 策略，未開源。
- **LuaN1aoAgent v2**（AGPL-3.0，1,491 star，第一屆第 3）：Planner／Executor／Observer；Observer 分熱路徑 Supervisor 與異步 Projector；Executor 收 TaskEnvelope；結論必須可追溯到持久事件、產物與圖證據；v1 成績不自動算到 v2。
- **CHYing-agent**（MIT，596 star，第一屆第 9）：Orchestrator＋Executor／Browser／C2／Reverse；復盤提到 orchestrator 能看到子 agent 全部工具時會自己做，使委派失效——對應角色工具准入。
- **AgentNote**（MIT，18 star，第一屆第 35）：OODA 迴圈＋可執行 notebook，把思考與執行寫成可重現單元。
- 其餘只核對描述：BUUCTF_Agent（Apache-2.0，267 star）、H-Pentest（未標示 license）、xbow-competition（未標示 license）、Cruiser（未標示 license）。

### 7.9 其他公開競賽：AIxCC

- DARPA AIxCC 的 CRS 有公開 repo：<https://github.com/trailofbits/afc-buttercup>（AGPL-3.0，決賽）、<https://github.com/trailofbits/asc-buttercup>（MIT，準決賽）、<https://github.com/shellphish/artiphishell>（MIT）、<https://github.com/fuzzingbrain/afc-crs-all-you-need-is-a-fuzzing-brain>（Apache-2.0）、<https://github.com/siftech/afc-crs-lacrosse>（MIT）。
- 任務是找漏洞並寫補丁，不是 CTF；只核對描述與 license，README 未讀。
- 可借點：競賽型 CRS 把確定性工具與 LLM 判斷組成可審計流水線，與薄宿主方向不同；「每個結論可追溯」與本倉庫證據方向一致。MIT／Apache 的實作可讀，AGPL 只取想法。

## 8. 跨項目整理

### 8.1 分類維度

| 維度 | 採用者 | 備註 |
|---|---|---|
| 按題型 | EnIGMA（demonstration／guideline）、ljagiello、naravid19 | 最常見，也最容易變成技術清單 |
| 按階段／狀態 | PentestGPT（任務樹）、hatrickkkk、PentestGPT v1 管線 | 有消融證據支撐的是「狀態」這一支 |
| 按問題症狀 | ljagiello 的 Fast Pattern Map（檔內路由） | 只見於單檔內部，不作為 skill 的切分維度 |
| 現場生成 | D-CIPHER auto-prompter | 效益依題型而異，有誤導風險 |
| 按證據與索引 | VulnClaw（原文證據＋高信號預覽）、pentestagent（notes→知識圖） | 第二批開始把「證據」當一級結構，不再只當上下文 |
| 按角色與權限 | pentest-ai-agents（Tier 1／2）、hackingBuddyGPT（planner／executor）、pentestagent（crew） | 與本倉庫角色設計重疊，多為自成一套 |
| 按圖搜尋（Fact／Intent） | Cairn（黑板＋平等 Worker）、BreachWeave（Idea／Memory） | 與 workbook 假設圖同構；Cairn 另證明不需要固定角色 |
| 按監督角色 | BreachWeave（Observer 旁路）、LuaN1ao（Supervisor／Projector） | 監督只讀軌跡、輕量糾偏，與執行分離 |

### 8.2 載入與觸發可靠性證據

- 倉庫類項目（ljagiello、naravid19）都依賴 description 匹配，並額外給手動入口；只有 ljagiello 提供了量測觸發的 evals，沒有公開結果。
- VulnClaw 把 Skill 做成「索引常駐、正文按需」，是 description 匹配與常駐索引之外的第三種位置；README 沒有觸發率或遵守率數據。
- pentest-ai-agents 用 50 個 description 路由的 subagent，規模更大，CI 仍只有結構檢查，沒有觸發或解題數據。
- 外部對照（非 CTF，用於判斷觸發是否可靠）：Vercel 的 agent evals 報告 56% 的 case 中 skill 從未被調用；把壓縮文檔索引常駐於 AGENTS.md 為 100%，skill 最高 79%（需明確提示）。一個小樣本獨立復現（Claude Code，每組 15 次）中純 skill 調用率 6%，加 hook 後 66%，結論是調用是可靠性問題而非內容品質問題。ETH Zurich 的 AGENTbench 另顯示常駐的 AGENTS.md 有時降低通過率（注意力稀釋）。來源：<https://vercel.com/blog/agents-md-outperforms-skills-in-our-agent-evals>、<https://blog.codeminer42.com/stop-putting-best-practices-in-skills/>（搜尋摘要，未讀原文）。
- CyberStrikeAI 把 Skill 做成漸進按需載入並提供 Skills 管理頁；README 沒有觸發率數據。
- 目前沒有 CTF 專用倉庫發表「觸發率」數據；競賽隊伍的成績也沒有拆到單一觸發機制。

### 8.3 reference 分層占比（定性）

| 層 | EnIGMA | PentestGPT | Cybench／NYU | ljagiello／naravid19 | hatrickkkk |
|---|---|---|---|---|---|
| 方法論／決策清單 | 中（guideline、demonstration） | 中（任務樹作狀態） | 低（格式與子任務） | 低（檔頭一小段） | 中（階段清單） |
| 工具用法 | 高（ACI 文檔） | 低 | 低 | 中（Prerequisites） | 低 |
| payload／技術庫 | 無 | 無 | 無 | 高（占主體，含題解與腳本） | 低 |

第二批多了「證據索引」一層：VulnClaw 存原文、上下文只放預覽；pentestagent 把 notes 建圖。這一層既不是方法論也不是 payload，上表沒有對應欄位。

### 8.4 有消融證據的知識類別

1. 帶試錯過程的 demonstration：EnIGMA 中影響最大（−6.2 個百分點），但 web 與 misc 反升。
2. 外顯狀態與下一步選擇：PentestGPT 去掉 Reasoning 最慘（最低）。
3. 互動工具與輸出摘要：EnIGMA 中各約 1–3 個百分點；簡單截斷式摘要有害。
4. 子任務引導：Cybench 上增益不穩定。
5. 現場生成的提示：D-CIPHER 中對 pwn 有誤導，整體有雙面性。
6. payload／技術庫的獨立貢獻：本次調研沒有找到任何消融。
7. 部分正確性評分（CTFJudge／CCI）：不是消融，是把未解出的 run 拆成步驟分；與 Cybench 的子任務完成率同向，需防「分數高≠解出」。
8. 參數與模型比較（HackSynth、CTFTiny）：temperature／top-p／token 與模型差異有實驗，但沒有知識組織的對照。
9. 規模化真實漏洞（CyberGym）：不是 CTF，也不比較知識類別；只說明小規模、只看靜態結果的評測不足。
10. 競賽名次不是消融：TSec 兩屆排名、唯一 AK 與 Cairn 的 7,692 元成本只說明在該賽制與時間點有效；沒有拆開單一機制的對照。

## 9. 對本倉庫的啟示

對照 [design §7、§8.2](../specs/2026-10-26-design-v1-b-method-generalization-and-efficiency.md)。

### 9.1 值得借鑑

1. **評測分層量測，而不是看內容。** ljagiello 的 routing／rules／solve 三層對應本倉庫 L1（調用）、「載入後是否遵守」、L2（改變行為）。可離線、小成本，且與 design §8.2「先用探針分辨觸發面與模型本身少調用」一致。落在邊界內：不新增 gate 的話，作為一次性探針設計即可。
2. **常駐、精簡的索引優於僅靠 description 匹配。** 外部證據一致指向調用不可靠；本倉庫 r7 為 0 次也如此。若 design §8.2 的 L1 探針確認問題在觸發，可優先考慮把「一行一條的方法決策清單」放進角色 prompt 或 workbook 的視圖，而不是擴 description；這與 design 的「不以提高載入率為目標」不衝突，因為這是改位置而非強制調用。需另行設計，並注意 AGENTbench 的注意力稀釋風險（保持短）。
3. **demonstration 形式的失敗→改法範例。** EnIGMA 的最大增益來自帶試錯過程的範例。本倉庫的「反覆嘗試同類回應」「輸出截斷與時間不足」兩項缺口適合用方法性的短範例（只寫行為轉折，不寫具體利用），可作為 design §8.2 的候選 C 的形式依據。
4. **輸出處理是方法與工具之間的缺口。** EnIGMA 證明簡單截斷比不用還差，LM 摘要優於不用。本倉庫的「輸出截斷」應看成工具能力問題，優先於 Skill 內容。
5. **外顯狀態是有消融證據的一支。** PentestGPT 的 Reasoning／任務樹與 workbook、design §8.1 的帳本同向；其「更新後做結構校驗，只許葉節點改動」可對照 workbook 的機械折疊（宿主不判斷內容）。
6. **現場生成的前提要標來源。** D-CIPHER 的 pwn 案例支持 Coordinator「不改寫事實、無來源前提記為缺口」的決定。
7. **入口識別→專項交接的鏈式結構**（hatrickkkk、naravid19）與現有角色流程重疊，無需新增。
8. **證據分兩層：原文全存、上下文只放高信號預覽。** VulnClaw 的 `AgentState.evidence`＋`evidence_view` 直接對應「輸出截斷」缺口，且比「寫檔後開窗口」或「另一次模型摘要」更貼近宿主職責：宿主保存原文與索引，模型自己決定何時回查。可先做最小的證據索引，不引入新的摘要模型。
9. **顯式證據閘門。** VulnClaw 的 FINAL 閘門與 hackingBuddyGPT 的 `task_solved` 都對照真實輸出，是機械比對、不靠模型自述；與 D 的「模型自述不能改成功狀態」一致。屬驗證層參考，不是新增 gate。
10. **Skill 索引常駐、正文按需載入。** VulnClaw 的 `load_skill_reference` 是第三種位置：不擴 description，也不把正文塞進 prompt，只保留一份可讀索引。與 design 的「不以提高載入率為目標」不衝突；是否改善採用仍待探針。
11. **notes→知識圖。** pentestagent 的 shadow graph 由宿主從 notes 建圖、模型讀來推導策略；與 workbook 假設圖同向，但只在 crew 模式出現，無評測。
12. **四種上限與統一痕跡。** hackingBuddyGPT 以輪數、token、金額、牆鐘時間同時封頂，痕跡用 OpenTelemetry GenAI JSONL 並附統計工具。本倉庫預算以 token 為主，金額與牆鐘可作為事後投影欄位，不必改現有停止語義。
13. **部分正確性與快速集。** CTFJudge／CCI 把未解出的 run 拆成步驟分，CTFTiny 提供 50 題快速集；可用於「候選寫入後的交回」這類近端驗證。限制是 LLM 判官與「分數高≠解出」，不能替代 solved 判定。
14. **枚舉先行。** hackingBuddyGPT 的 `ExPrivEscLinuxLSE` 先跑列舉腳本、再按提示逐項編排，可支撐 §9.4 特權 helper 缺口的流程；只借流程，不搬腳本。
15. **Idea／Memory 分離。** BreachWeave 把「值得推進的方向」與「可複用的事實、證據、約束」分開存。workbook 已有 hypotheses 與 facts，可檢查兩者是否在同一視圖互相污染；分開是宿主可做的結構調整，不需要新模型。
16. **結束條件外置。** BreachWeave 的 Ralph-Loop 與 LuaN1ao 的任務預算與 `planner_submit` 終止工具，都把「是否結束」交給系統狀態而非模型自判；與現有停止規則同向，提供「以任務圖與預算共同約束」的具體形狀。
17. **Observer 旁路監督。** BreachWeave 的 Observer 只讀最近軌跡、做輕量糾偏，不接管執行；LuaN1ao 另把監督拆成熱路徑 Supervisor（控制決策）與異步 Projector（更新圖）。與 Critic 的差別是前兩者不進入解題迴圈。可作為「停滯／偏移」信號的來源之一。
18. **黑板 Fact／Intent／Hint。** Cairn 的三原語比 workbook 更徹底地把「事實」「方向」「人類提示」分開；可借結構，不借「無角色」的結論——那是單一賽事結果。
19. **子 agent 的工具可見性。** CHYing-agent 的復盤觀察：orchestrator 看得到子 agent 的全部工具時會自己做，委派形同虛設。對應本倉庫「派單後誰有權限」與角色工具准入，值得在交接測試中觀察。
20. **工具執行韌性清單。** CyberStrikeAI 的 worker 隔離、有界等待、可續接輪詢、取消、斷路器、併發上限、統一輸出上限，可逐項對照 G 的 job 契約；其中「可續接輪詢」與「統一輸出上限」直接對應現有兩個缺口。
21. **競賽接口與計分。** TSec 的限頻、併發上限、提示扣分、多 flag、名次衰減，是平台側約束的具體樣本；可作為 E／C 的接口對照與 G 的資源邊界參考，不用於改當前 solved 語義。

### 9.2 落在邊界外

1. **按題型鋪 payload、技術庫、wordlist、題解索引**（ljagiello、naravid19 的主體）：design 明確排除；且沒有任何消融證明這類內容獨立提升解題率。
2. **PayloadsAllTheThings 類索引、pwnable.tw 題解、可執行利用模板腳本**：屬「題解與 payload」。
3. **依賴外部搜尋 API 的 writeup 檢索**（`ctf-similar-search`）：對應 design §7 邊界的「不新建檢索服務」；也有題目污染的風險（CTFusion 的去污染結果差異即為警示）。
4. **按題型拆成八個專家 subagent**：沒有收益證據，且 D-CIPHER 的資料顯示強弱混搭與交接都有損耗。
5. **廠商自報的 CTF 成績**（CAI）：無方法細節，不能作為設計依據。
6. **50 個專家 subagent**（pentest-ai-agents）：無收益證據，角色膨脹與薄控制層衝突；其 findings DB 與交接格式可另看。
7. **方法論／CVE／wordlist 的 RAG 自動注入**（pentestagent 的 `knowledge/sources/`、VulnClaw 的 33 檔 web 進階與 40 檔知識庫）：內容邊界外。
8. **公開解題痕跡**（BoxPwnr-Traces）：題解與污染風險；AGPL 也不宜併入。
9. **AGPL 框架整體引入**（HackSynth、BoxPwnr、Pentest-Swarm-AI）：只取想法，不取代碼。
10. **智能合約 CTFBench**：與 CTF 無關，已排除，避免同名誤引。
11. **直接接入或重放競賽平台**（TSec challenge、xbow）：不在授權範圍；本節只讀公開資料。
12. **未標示 license 的競賽程式碼**（aide、tinyctfer、xbow-competition、H-Pentest、Cruiser，以及 TSec 資源倉本身）：不借用內容。
13. **AGPL 競賽專案**（Cairn、LuaN1ao、afc-buttercup 決賽）：只取想法。
14. **「零領域知識」哲學**（aide／tinyctfer）：與現行 Skill 內容方向相反；若要驗證，需自己的對照，不直接採納。
15. **競賽名次與廠商自報**（含長亭 94%）：賽制、時間點與模型都不同，不作設計依據。

### 9.3 對現有 design 文字的更正建議（不在本任務內修改）

- design §7 對 Cybench 的描述（「子任務分解／有界推進顯著提升解題」）與論文表格不符，宜改為「增益隨模型而異且不穩定，分數化進度更能顯示進展」；design §7 優先序 #3（節拍器）的依據需相應降級，改由 PentestGPT 的狀態管理證據支撐。
- design §7 對 EnIGMA 的概括（高杠桿專用工具與 ACI）屬實，但可補上：最大消融項是 demonstration，且 web 類沒有隨工具受益。
- 「Skill 內容增量優先序最低」的判斷得到外部旁證（觸發不可靠、payload 庫無獨立消融證據），維持不變。

### 9.4 與已知缺口的對應

| 已知缺口 | 調研中的相關組織方式 | 判斷 |
|---|---|---|
| Java 序列化鏈施工 | 各倉庫都把此類放入 payload／技術庫 | 邊界外；若要補，只能寫成方法性步驟，不寫鏈與 payload |
| 目標特權 helper 的列舉與使用 | hatrickkkk 的提權階段清單；hackingBuddyGPT 的 `ExPrivEscLinuxLSE`（先列舉、再按提示編排） | 可借鑑「列舉優先於猜測」的清單與流程，內容留方法層，不搬腳本 |
| native RASP | 無項目涉及 | 無可借鑑 |
| 輸出截斷與時間不足 | EnIGMA 的 summarizer 消融；VulnClaw 的原文證據＋高信號預覽＋`evidence_view`；CyberStrikeAI 的統一輸出上限與可續接輪詢 | 屬工具／宿主能力，優於 Skill 內容；VulnClaw 給兩層做法，CyberStrikeAI 補「輪詢續接」 |
| 反覆嘗試同類回應 | EnIGMA 的 demonstration、PentestGPT 的葉節點更新校驗、VulnClaw 的 stall guard；BreachWeave 的 Observer、Cairn 的 Intent 去重、LuaN1ao 的 Supervisor | 範例形式與機械偵測可借鑑，不靠提示詞；監督與去重可放宿主 |
| 未驗證前提的交接 | hackingBuddyGPT 的 planner／executor＋共享知識庫；LuaN1ao 的證據→假設圖；Cairn 的 Fact／Intent 分離 | 與「前提標來源」同向；事實與方向分表，支持狀態留在宿主 |

## 10. 來源清單

第 1 批（2026-11-12）：

- <https://arxiv.org/html/2409.16165v3>、<https://github.com/SWE-agent/SWE-agent>
- <https://github.com/NYU-LLM-CTF/nyuctf_agents>、<https://arxiv.org/pdf/2502.10931>、<https://arxiv.org/pdf/2605.11504>
- <https://github.com/GreyDGL/PentestGPT>、<https://arxiv.org/html/2308.06782>
- <https://github.com/andyzorigin/cybench>、<https://arxiv.org/html/2408.08926>
- <https://github.com/aliasrobotics/cai>
- <https://github.com/ljagiello/ctf-skills>（含 `ctf-web/SKILL.md`、`evals/`）
- <https://github.com/naravid19/claude-ctf-skills>、<https://github.com/hatrickkkk/ctf-claude>
- <https://vercel.com/blog/agents-md-outperforms-skills-in-our-agent-evals>、<https://blog.codeminer42.com/stop-putting-best-practices-in-skills/>

第 2 批（2026-11-19）：

- <https://github.com/Netw0rkNoob/VulnClaw>
- <https://github.com/ipa-lab/hackingBuddyGPT>
- <https://github.com/aielte-research/HackSynth>、<https://arxiv.org/abs/2412.01778>
- <https://github.com/GH05TCREW/pentestagent>
- <https://github.com/0xSteph/pentest-ai-agents>
- <https://github.com/KHenryAegis/VulnBot>、<https://arxiv.org/abs/2501.13411>
- <https://github.com/Armur-Ai/Pentest-Swarm-AI>
- <https://ojs.aaai.org/index.php/AAAI/article/view/40210>、<https://github.com/NYU-LLM-CTF/CTFTiny>、<https://github.com/NYU-LLM-CTF/CTFJudge>
- <https://arxiv.org/abs/2506.02548>、<https://github.com/sunblaze-ucb/cybergym>
- <https://github.com/0ca/BoxPwnr>、<https://github.com/0ca/BoxPwnr-Traces>
- 競賽：<https://github.com/Yeti-791/Tsec-Hackathon>（含第二屆 API／MCP 文檔）、<https://github.com/m-sec-org/BreachWeave>、<https://github.com/oritera/Cairn>、<https://github.com/AIPentest/CyberStrikeAI>、<https://github.com/chainreactors/aide-for-pentest>、<https://github.com/chainreactors/tinyctfer>、<https://github.com/SanMuzZzZz/LuaN1aoAgent>、<https://github.com/yhy0/CHYing-agent>、<https://github.com/C1JC/AgentNote>
- AIxCC：<https://github.com/trailofbits/afc-buttercup>、<https://github.com/trailofbits/asc-buttercup>、<https://github.com/shellphish/artiphishell>、<https://github.com/fuzzingbrain/afc-crs-all-you-need-is-a-fuzzing-brain>、<https://github.com/siftech/afc-crs-lacrosse>
- 已排除：<https://github.com/ctfbench/ctfbench>（智能合約審計，非 CTF）
