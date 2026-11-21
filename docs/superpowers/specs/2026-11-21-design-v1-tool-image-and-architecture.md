# design v1 解題工具映像與架構詳細 design

**狀態（2026-11-21）：已落地（開發部署）。** launcher 以 `--tool-image` 啟用每會話工具容器；無模型檢查、腳本化整題 run 與獨立 Linux arm64 Docker Engine 都通過。真實模型 2 個 run 只作觀察，不下清單有效性結論；產品部署與 job 網路仍歸 G §5.4–5.5。

本文是 [design v1](2026-10-22-ctf-agent-design-v1.md) 第 2 節 F（Docker 可交付佈局）與 G（首版工具集）的子文件，承接第 3 節待決項「工具套件、版本與 ARM64 可用性」，工具供給的細節以本文為準。job 的契約（工作目錄、環境變數白名單、程序組、輸出上限、不臨時安裝）沿用 [G 詳細 design §5.3](2026-10-23-design-v1-g-solver-minimal.md#53-執行環境)，隔離方向與部署責任沿用 §5.4，網路以 §5.5 為準。調研原文與來源等級見[執行環境調研](../analysis/2026-11-21-job-tool-environment-survey.md)，驗證數字見 [gate 摘要](../../gates/tool-image-20261121/summary.json)。

## 1. 要解決的問題

**受管 job 原本用的是開發機上的工具，執行環境既不固定也不可交付。** job 在 launcher 所在環境直接啟動，沿用 launcher 的 `PATH`，G §5.3 要求的「`PATH` 採鏡像固定值」不成立。基線中 RustAction 的 4 次未解 run 都以工具缺口結束，其中可確認開發機沒有 Rust 工具鏈，但 4 次停止原因各不相同，不能據此推算換環境能多解幾題（[B §7](2026-10-26-design-v1-b-method-generalization-and-efficiency.md#7-方向与优先序)）。

本文回答四件事：映像裝什麼、ARM64 宿主上怎樣處理 x86 程式、job 在哪裡跑、角色怎樣事先知道環境裡有什麼。範圍決定（2026-11-21 用戶）：Pwn、Reverse、Mobile 的工具也預裝，但不為它們建角色、Skill 或方法內容，只觀察模型能否自行選用；design v1 §1.1 已同步。

## 2. 映像構成

**以 Ubuntu 24.04 LTS ARM64 為底，按能力分層建置成單一工具映像（[Dockerfile](../../../docker/tool-image/Dockerfile)）。** design v1 §1.6 只指定 Ubuntu ARM64，24.04 是本文的選擇。不用 Kali 作底座：空的 Kali 底座同樣不帶工具，未固定來源時滾動更新容易讓重建結果漂移；有工具只在 Kali 套件庫方便取得時再個別引入。工具映像與產品映像合併還是分開，隨 G §5.4 的部署決定。

| 層 | 已實測的能力 | 未壓縮大小 |
| --- | --- | ---: |
| 通用執行 | Python、Node、shell 與文字工具、歸檔與編碼、curl、socat | 304 MB |
| 編譯工具鏈 | C／C++、Go 1.22、Rust 1.75 與 Cargo 離線建置（只含標準庫，沒有第三方 crate） | 923 MB |
| Web 與 Crypto | HTML 解析、大數與模運算（gmpy2、PARI/GP）、符號計算、約束求解（z3）、`Crypto` 命名空間 | 172 MB＋17 MB |
| Misc／取證 | 格式辨識、解包、中繼資料、影像處理、檔案系統取證 | 59 MB |
| Pwn／Reverse | 跨架構反組譯（binutils、radare2）、保護屬性檢查、gdb-multiarch、QEMU user-mode 與 x86 sysroot、交叉編譯器與標頭檔、pwntools | 494 MB＋235 MB＋46 MB |
| Mobile | APK 解包與 smali（apktool）、JDK | 396 MB |

整個映像在磁碟上約 3.65 GB，下載內容約 0.9 GB；最大的是編譯工具鏈與 Mobile 的 JDK。**需自建、尚未納入：** Ghidra、jadx、dex2jar、smali 獨立工具、SageMath，都沒有 Ubuntu arm64 套件，出現實際缺口時再補。

**版本固定。** ARM64 的 Ubuntu ports 套件庫不套用 apt snapshot，所以版本靠鎖底座 digest，加上建置時寫出的已安裝套件清單（`/opt/ctf-tools/packages.txt`、`python-packages.txt`）；重建時新的套件更新仍可能進來，這是目前的重現性限制。每次 run 以映像 id（不是可移動的標籤）啟動容器，並記入 evidence。

**兩個建置時才發現的細節：** Ubuntu 的 `python3-pycryptodome` 只提供 `Cryptodome` 命名空間，常見寫法 `from Crypto ...` 要另從 PyPI 裝 pycryptodome；pwntools 會在 `PATH` 較前的位置裝一個同名的 `checksec`，Ubuntu 版要用完整路徑 `/usr/bin/checksec`，工具清單兩者都列。

**單一映像維持。** 冷建容器約 0.1–0.16 秒（映像已在本機），與映像大小無關，代價集中在首次下載，沒有拆分的理由。

## 3. x86 程式的處理

**工具一律用 ARM64 原生版本；需要執行的 x86 Linux 程式交給映像內的 QEMU user-mode。** 不依賴 Rosetta、宿主特權或 Docker socket。已驗證：自寫加法程式的 amd64 靜態、amd64 動態、i386 動態三版都輸出正確並載入 sysroot 內的 glibc 2.39；QEMU 的 gdb 介面接 gdb-multiarch，amd64 與 i386 都能命中具名函式、讀到參數值並讓程式正常結束。

**Linux ARM64 宿主。** 除了 Docker Desktop，同一組 x86 檢查（三版執行、amd64 與 i386 的 gdb 斷點讀值）與程序組取消，也在獨立的 Linux arm64 Docker Engine 29.10（`docker:dind`，不經 Docker Desktop 的整合）上以相同容器設定通過。QEMU 由 job 明確啟動，不依賴 binfmt 或 Rosetta。兩者共用 Docker Desktop 的 6.12 核心，實體伺服器的核心版本與引擎設定差異到部署時再核對。

| 工作 | 做法 | 不支援時 |
| --- | --- | --- |
| 靜態分析 x86 ELF／Windows PE | 原生跨架構工具 | — |
| 執行 x86-64／i386 Linux 程式 | `qemu-x86_64`／`qemu-i386 -L /usr/<triplet>` 指向映像內 sysroot | 需要其他 glibc 版本時回報缺能力，不臨時下載 |
| 動態除錯 x86 程式 | `qemu-* -g <port>` 接 gdb-multiarch | 需要原生 `ptrace`、精確核心或時序行為時，記為環境邊界 |
| Windows 程式動態執行 | 不支援 | 記為環境邊界 |
| Android 動態執行 | 不在容器內（官方說明模擬器在 Docker 等虛擬機內不支援加速） | 記為環境邊界；arm64 模擬器若需要，另案在宿主評估 |

**模擬代價比調研時擔心的小。** 同一個 3 億次迴圈的 C 程式，QEMU 執行 amd64 版是原生 ARM64 的 1.9–2.7 倍（兩次測量）。本地題目的 amd64 映像在這台 Docker Desktop 上由 Rosetta 執行（容器內可見 Rosetta 解譯器），自寫 HTTP 服務的請求中位數約 4 毫秒，原生約 1 毫秒，就緒時間都約 0.15 秒。這些都遠小於 job 的 60 秒預設期限，不需要因模擬調整期限。另備 amd64 工具映像只在出現「多個 x86 工具必須一起運作、或工具只有 x86 版」的實際缺口時再議。

## 4. job 執行位置

**launcher 留在宿主，每個解題會話一個工具容器，job 經 `docker exec` 在容器內執行。** launcher 以 `--tool-image <image>` 啟用；不給這個參數時，launcher、控制服務與 plugin 的行為和以前相同，既有 run 與配對對照不受影響。實作在 [job-tools.ts](../../../apps/launcher/src/job-tools.ts) 的 `ToolContainers` 與 `JobManager` 容器模式。

- **容器設定：** `--init`、`--network none`、`--cap-drop ALL`、`no-new-privileges`、以 launcher 的 uid 執行；工作區、材料與已發布目錄以相同絕對路徑掛載，後兩者唯讀。
- **生命週期：** 會話的第一筆 job 時建立，同一 run 內重用；會話中途停止不回收（之後可能續派），run 收尾時全部回收。
- **程序組：** 容器內一段固定開場程式以 `setsid` 開新程序組並記下組號，取消、逾時與存活檢查都在容器內對這個組號執行，同容器其他 job 不受影響。**容器必須有會回收孤兒程序的 init**：沒有 `--init` 時，被終止的子程序會留成殭屍、仍掛在原程序組裡。
- **找不到程式：** 開場程式先確認 argv[0] 存在，不存在時宿主報 `failed_to_start`（與 G §5.3 一致）；程式自己以 127 結束時照實回報。
- **代價：** 每筆 job 多約 0.2 秒的 `docker exec` 往返（宿主直接執行約 3 毫秒）。

**網路目前關閉。** G §5.5 的 job 網路 scope 尚未定案，工具映像模式下 job 一律不能連網；受管 `http.request` 不經容器，照常可用。需要以腳本直連題目服務的題目，在網路契約定案前應以宿主模式執行。`ToolContainers` 的網路設定已留成參數，由 G §5.5 決定後接上。

另一個做法是 launcher 與 job 同在一個容器：所有會話共用檔案與程序視圖，不滿足會話隔離，不採用。產品部署由哪個可信元件建立與回收工具容器，仍是 G §5.4 的待決問題；開發部署由宿主端 launcher 負責，不把這個權限帶進產品容器。

## 5. 角色可見的工具清單

**建映像時機械產生工具清單 `/opt/ctf-tools/inventory.json`，隨映像固定。** 每項列能力、入口命令、版本行、架構與狀態；探測要求 Python 匯入成功、其他工具不得回報「找不到」。目前 39 項已安裝、5 項需自建，另附 x86 的執行與除錯用法和 sysroot 位置。

**呈現方式：** 啟用工具映像時，`job.run` 的工具說明多一句，指出清單位置、可用 job 讀取、執行中不能安裝；清單本身不併入常駐 context，因為常駐內容的作用正由 [Skill 發現與使用 §10](2026-10-24-design-v1-skill-discovery-and-use.md#10-常駐原則與跨-session-的方法承接) 對照驗證中。launcher 啟動時把映像 id、清單 SHA-256 與清單內容寫入 `evidence/tool-image.json`，事後可以核對該次 run 實際有哪些工具。

## 6. 驗證結果

全部只用自寫的無害樣本與既有的合成 fixture，不用題目材料；檢查經 launcher 同一條容器路徑（`ToolContainers`＋`JobManager.run`）在兩個會話容器內執行（[檢查腳本](../../../tests/manual/tool-image-check.mts)），28 項全部通過；確定性測試 845 項通過，其中 3 項覆蓋預設關閉、`--tool-image` 參數與工具說明。

| 問題 | 結果 |
| --- | --- |
| 工具能否離線使用 | Rust、Cargo、C、Go、Python 樣本離線編譯並執行；Crypto、Web 解析、影像中繼資料、歸檔、binwalk、radare2、checksec、pwntools、apktool 的功能檢查通過；清單無缺失項 |
| x86 能否執行與除錯 | amd64 靜態／動態、i386 動態都正確；兩種架構的 gdb 斷點、讀值、正常結束都成立 |
| 工具容器能否保住 job 契約 | 環境只含白名單（外加 shell 自設的 `PWD`）、`PATH` 為映像固定值、cwd 正確、非 root；`work/` 可寫、材料與已發布不可改；兩會話檔案與程序互不可見；退出碼、增量輸出、截斷統計正確；取消與逾時只清目標組、容器可重用；找不到程式報 `failed_to_start`；run 收尾後不留容器 |
| 代價 | 下載內容約 0.9 GB、磁碟 3.65 GB；冷建容器約 0.1–0.16 秒；每筆 job 約 0.2 秒；QEMU 慢 1.9–2.7 倍 |
| 清單能否讓角色讀到 | `job.run` 讀到的清單雜湊與 launcher 寫入 evidence 的雜湊一致；工具說明在啟用時指向清單、未啟用時不變 |
| 整題 run | 以腳本化 provider（0 次真實模型呼叫）跑 [G 團隊接線 fixture](../../../tests/manual/g-team-integration.ts)，工具映像模式與宿主模式對照：兩種模式的 job 結果（Solver 先失敗後修正、Engineer 讀材料重算）與輸出一致；工具映像模式為兩個用到 job 的會話各建一個容器、以映像 id 啟動、run 結束時全部回收；evidence 有映像 id 與清單雜湊；模型收到的 13 份 `job.run` 說明都指向清單（宿主模式 0 份）。兩種模式都停在 Verifier 派單被拒，這是 fixture 早於現行 Verifier 版本門檻、與工具映像無關的既有問題 |
| Linux arm64 Docker Engine | 見第 3 節 |
| 真實模型是否先讀清單、工具缺口停止是否改變（Q5） | 2 個 run（RustAction，工具映像）對照基線同題 2 個 run（宿主模式）。清單指引送達：兩個 run 的 Domain Solver 推理各提到清單路徑 1 次（第 4、第 9 次 job 之後），之後都沒有派 job 讀它。4 個 run 的 job 全部正常退出，輸出都沒有網路錯誤；與題目服務的往來走受管 `http.request`，job 網路關閉沒有擋到解題。工具映像 run 有 3 次 job 實際執行 `cargo build`（無依賴的小專案，不需要下載），但工作區沒有建置產物，其中 1 次輸出含錯誤、退出碼卻是 0。停止歸因 skill 1、tool 1；基線 2 個 run 皆為 tool，其中 1 個的缺口描述提到 Rust／編譯，工具映像 run 的缺口描述都沒提 Rust、編譯或網路。只作觀察，樣本不足，不下清單有效或無效的結論，也不改角色提示（[gate](../../gates/tool-image-run-20261121/summary.json)） |

**尚未定論：** 指引已送達且被注意到，模型仍沒讀清單，原因要看推理原文；工具映像讓 Rust 工具鏈可用，但建置為何沒留下產物（映像缺項、失敗被管道吞掉或事後清除）也分不出。兩者都屬題目層面的閱讀，交實驗模式 session 核對 gate 列出的 job；確認是映像或 job 契約問題，才改映像（如 Cargo 的家目錄或快取）。停止歸因是否真的改變要另行授權更多 run，不據此加角色提示（B §7 已停止提示位置補丁）。

## 7. 不做的事

- 不以整套 Kali 套件代替能力選擇，不承諾「全領域工具齊備」。
- 產品容器內不註冊宿主的跨架構解譯器。
- 不為 Pwn、Reverse、Mobile 建角色、Skill 或方法內容。
- 不在容器內提供 Windows 或 Android 的動態執行環境。
