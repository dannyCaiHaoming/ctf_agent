# 解題執行環境的工具供給：開源做法與方案取捨（2026-11-21）

**狀態：現行。** 供 [G 最小版 §5.3–5.4](../specs/2026-10-23-design-v1-g-solver-minimal.md#53-執行環境) 與 [design v1 第 3 節](../specs/2026-10-22-ctf-agent-design-v1.md)「ARM64 工具套件」待決項選型參考；觸發事實見 [B §7 第二個選題](../specs/2026-10-26-design-v1-b-method-generalization-and-efficiency.md#7-方向与优先序)。由 codex（gpt-6.2-astra，開網路搜尋）只讀調研，Opus 核對倉庫內依據；未建置或執行任何映像。映像大小為發布者登錄的單一架構壓縮量，非本項目實測；「？」表示本次查不到。引用進 design 前，標「需回原文核對」的項目要先核對。

**建議選 A：以 Ubuntu 24.04 LTS ARM64 為底，按能力分層建置，首版發布一個工具映像。** 官方 Ubuntu 24.04 ARM64 基底壓縮後是 **27.62 MB**，Kali Rolling ARM64 裸底是 **49.93 MB**，而且 Kali 裸底也沒有預裝預設工具集。真正值得比較的是加完編譯器、函式庫與瀏覽器後的成品。RustAction 已證實本機 launcher 找不到 `rustc`／`cargo`，但四次停止只有一次明指 Rust 工具鏈，不能據此推算換映像能多解幾題。[Ubuntu 映像](https://hub.docker.com/_/ubuntu/tags?name=24.04) · [Kali 映像](https://hub.docker.com/r/kalilinux/kali-rolling/tags) · [Kali 官方說明](https://www.kali.org/docs/containers/official-kalilinux-docker-images/) · [B 設計 §7](../specs/2026-10-26-design-v1-b-method-generalization-and-efficiency.md)

## 工具供給與方案取捨（第一輪）

### 開源專案怎麼供給工具

大小均為發布者登錄的**單一架構壓縮量**。表中「？」表示本次查不到；能用 `sudo`、能連題目網路，都不足以判定專案允許 run 內下載套件。

| 專案 | 基底、工具與分映像方式 | 架構／大小 | run 內安裝與網路 | 來源等級 |
|---|---|---|---|---|
| EnIGMA v0.7 | 共用 `sweagent/swe-agent:0.6.1`，加數學、檔案分析與模擬工具；底層 OS 版本待核 | amd64，4.21 GB | 安裝政策？；設 `ctfnet`，公網政策？ | 已讀原文：[Dockerfile](https://raw.githubusercontent.com/SWE-agent/SWE-agent/v0.7/docker/enigma.Dockerfile) · [部署文件](https://swe-agent.com/0.7/installation/source/) · [映像](https://hub.docker.com/r/sweagent/enigma/tags) |
| Cybench | 共用 Kali Large 加 Python 與 benchmark 依賴；題目服務另起容器 | 2024-09-13 成品 amd64 **19.08 GB**、arm64 **6.93 GB** | 共用題目網路；公網與安裝政策？ | 已讀原文：[Dockerfile](https://raw.githubusercontent.com/andyzorigin/cybench/main/Dockerfile) · [論文](https://arxiv.org/html/2408.08926) · [映像](https://hub.docker.com/r/cybench/cybench/tags) |
| NYU baseline／D-CIPHER | 兩者均有 Ubuntu 22.04 依據；D-CIPHER 共用工具映像含腳本、編譯及二進位分析工具 | D-CIPHER 寫死 amd64 套件並啟用 i386；大小？ | `ctfnet`；D-CIPHER 有免密 sudo，安裝政策？ | 已讀原文：[baseline 文件](https://nyu-llm-ctf.github.io/docs/usage/framework/) · [網路設定](https://nyu-llm-ctf.github.io/docs/configuration/parameters/) · [D-CIPHER 映像](https://raw.githubusercontent.com/NYU-LLM-CTF/nyuctf_agents/main/docker/multiagent/Dockerfile) |
| PentestGPT | 倉庫工具映像用 Ubuntu 24.04，含 Python、編譯、網路及文字工具；harness 在外 | ？／？ | 容器容許 pip、免密 sudo；Compose 配 VPN 與 host gateway。新版框架接線仍待完成 | 已讀原文：[Dockerfile](https://raw.githubusercontent.com/GreyDGL/PentestGPT/main/Dockerfile) · [Compose](https://raw.githubusercontent.com/GreyDGL/PentestGPT/main/docker-compose.yml) |
| HackSynth | Kali Rolling；首次建立共用容器時裝 `kali-linux-headless`，後續重用 | ？／？ | 初始化需連套件庫；論文描述執行期防火牆限指定主機，臨時安裝政策？ | 已讀原文：[初始化](https://raw.githubusercontent.com/aielte-research/HackSynth/main/docker_setup.py) · [論文](https://arxiv.org/html/2412.01778v1) |
| InterCode-CTF | 共用 Ubuntu Bash 映像，預裝 Python、GCC、GDB；新題缺依賴時回改 Dockerfile | ？／？ | 建置時補依賴；run 內安裝與出口？ | 已讀原文：[論文 §3](https://openreview.net/pdf?id=KOZwk7BFc3) |
| CAI | 可在宿主執行，也可指定既有容器；工具與基底取決於所選環境 | 隨環境／？ | 統一的安裝與出口政策？ | 已讀原文：[環境設定](https://aliasrobotics.github.io/cai/cai/getting-started/configuration/) |

### A、B、C 的取捨

| 方案 | 大小與冷啟動 | 更新、重現與維護 |
|---|---|---|
| **A．Ubuntu LTS／Debian stable 精選** | 可逐層量增量；一個成品只維護一套執行環境 | 自己維護短清單與版本；選 Ubuntu 可沿用產品契約，Debian 需另決定 |
| **B．Kali 裸底／headless** | 裸底仍要選工具；headless 拉入整組相依，首次下載、解壓成本預期較高，大小未實測 | 選包省事；rolling 持續變動，未固定來源的重建容易漂移 |
| **C．Kali 精選套件／小型套件組** | 可控制體積；若實際安裝相同，不能預設比 A 大多少 | 仍要維護清單並承擔 rolling 更新；有具體 Kali 套件需求時才值得更換基底。[官方套件組定義](https://www.kali.org/docs/general-use/metapackages/) |

三者都可在建置期備齊依賴。部署鎖成品 digest；要能重建，另鎖基底 digest、套件來源快照與語言依賴。run 用非 root，出口由容器外限制。Apple Silicon 優先跑原生 ARM64 工具；讀取 x86 檔案或連到獨立 amd64 題目服務，都不要求工具容器模擬 x86。必須本地執行 x86 程式時，才另驗模擬或原生 amd64，尤其要量編譯耗時。[Docker 跨架構文件](https://docs.docker.com/build/building/multi-platform/) · [本地題目部署](../../local-challenges.md)

### job 放哪裡

| 做法 | 對本案的判斷 |
|---|---|
| launcher 與 job 同容器 | 最少改動，沿用 `spawn`、路徑、程序組及輸出處理，每筆 job 沒有 `docker exec` 往返。適合驗工具供給；共用檔案與程序視圖仍無法滿足會話隔離，環境變數白名單只管傳給子程序的值。[現行實作](../../../apps/launcher/src/job-tools.ts) |
| 主機 launcher＋每會話工具容器 | **建議的開發部署**。一個會話建一次，之後重用；材料與已發布檔唯讀，只有該會話工作區可寫。沿用 G 已驗過的隔離方向；正式版仍要決定哪個可信元件負責建立、回收，Docker socket 留在產品與工具容器之外。取消須驗證容器內子程序真的停止，不能只看本機 `docker exec` 結束。[G §5.4–5.5](../specs/2026-10-23-design-v1-g-solver-minimal.md) |

### 首版能力與最小驗證

- **通用執行**：Python 腳本、C／Go／Rust 離線編譯；先驗有缺口證據的 Rust。標準庫、已隨映像備妥的第三方依賴分開列，避免角色把「有 Cargo」理解成「任意 crate 都可用」。
- **用戶決定（2026-11-21）：Pwn、Reverse、Mobile 所需工具也預裝。** 不為這三類建角色、Skill 或方法內容，只觀察模型能否自行選用；下一條「留待範圍決定」的說法以此為準。x86 執行與除錯在 ARM64 宿主上的可行性見文末「架構」一節。
- **Web／Crypto／Misc**：分別列受管 HTTP／會話與按需瀏覽器、整數與模運算／編碼、格式辨識／解包／中繼資料讀取。Pwn、Reverse、Mobile 留待範圍決定。host 依映像 digest 向角色提供短表：能力、入口、版本、架構、離線限制與實測狀態。[核心設計 §1.1、§1.5](../specs/2026-10-22-ctf-agent-design-v1.md) · [工具分析 §5.2](2026-10-29-ctf-tooling-analysis.md)
- **先驗一件事**：讓現有 `job.run` 在固定 ARM64 映像內，斷網編譯並執行同一份無害 Rust 樣本。再用同批合成工作對照原入口，驗退出碼、增量輸出與截斷、逾時取消、跨會話隔離。分記首次下載、已有映像時建容器、暖容器啟動 job 三段時間。這批能回答工具是否可用及代價；解題率仍未知。此次僅只讀查核，未建置或執行。

**需回原文核對**：EnIGMA 0.6.1 基底的發布來源；Cybench 指定版本的公網出口規則；表內「？」所列的 run 內安裝政策、平台與大小。另須實測本案選定套件的 ARM64 功能，以及允許題目端點時能否同時封住其他出口。[EnIGMA 映像](https://hub.docker.com/r/sweagent/enigma/tags) · [Cybench 倉庫](https://github.com/andyzorigin/cybench) · [核心設計 §3](../specs/2026-10-22-ctf-agent-design-v1.md)


## 架構：ARM64 宿主上處理 x86（2026-11-21 第二輪）

同樣由 codex（gpt-6.2-astra，開網路搜尋）只讀調研、Opus 核對；本機事實：Apple Silicon、macOS 26.6、Docker Desktop 4.78，Rosetta 開關讀取遭拒、未知；本地題目映像全是 amd64、已靠模擬運行。未建置、下載或執行任何映像。

**可以。建議保留 Ubuntu 24.04 ARM64 工具映像，靜態分析用原生工具，只有需要執行的 x86 Linux 程式才交給 QEMU。** 這條路在 Apple Silicon 與 Linux ARM64 都成立。另備 amd64 映像的理由是需要完整 x86 使用者空間；需要精確的核心、`ptrace` 或時序行為時，原生 x86_64 機器更合適。

### 1．機制與權限

| 機制 | Mac 開發機（Docker Desktop） | Linux ARM64 伺服器 |
|---|---|---|
| Rosetta for Linux | 在 Apple Virtualization framework 下啟用 Rosetta，可加速 `linux/amd64` 容器內的 x86_64 程式；Docker VMM 官方仍列為不支援 Rosetta。本機設定檔讀取遭拒，4.78 實際使用哪個後端仍未知。 | 無 Rosetta。[Docker 設定](https://docs.docker.com/desktop/settings-and-maintenance/settings/) · [VMM 限制](https://docs.docker.com/desktop/features/vmm/) |
| QEMU user-mode | ARM64 容器可用普通使用者明確啟動 `qemu-x86_64` 或 `qemu-i386`，毋須註冊 `binfmt_misc`。Desktop 另提供透明跨架構執行。 | 明確啟動的做法相同。若要透明執行整個 amd64 容器，須由管理員在宿主註冊靜態 QEMU 解譯器及 `F` 旗標；可在部署時用一次特權容器完成，重開機後須恢復註冊。[QEMU](https://www.qemu.org/docs/master/user/main.html) · [Docker 跨架構文件](https://docs.docker.com/build/building/multi-platform/) |
| 整機模擬／原生遠端 | 宿主用 UTM／QEMU system 啟動完整 x86 客體，可選 Linux 或 Windows 核心。跨指令集走軟體模擬，須準備客體映像、RAM、磁碟。 | QEMU system 同樣可用 TCG。兩種 ARM 宿主也都可由 launcher 使用獲授權的遠端 x86_64 機器，以原生速度、指定核心作對照。[UTM](https://docs.getutm.app/) · [QEMU system](https://www.qemu.org/docs/master/system/introduction.html) |

以上都容許產品與工具容器維持非 root、無 Docker socket。建立會話容器、註冊解譯器、管理 VM 或遠端憑據屬於可信宿主；倉庫目前仍未定產品部署時由誰建立及回收容器。[G §5.4](../specs/2026-10-23-design-v1-g-solver-minimal.md)

### 2．實際工作差異

| 工作 | Mac 與 Linux ARM64 的判斷 |
|---|---|
| 靜態讀取 x86 ELF／Windows PE | 兩端用支援 x86 的原生 LLVM 或 Ghidra 即可反組譯；Ghidra 可反編譯。要核對工具本身的宿主套件：上游指南把 Linux ARM64 列為需自建原生元件的平台，應在建映像時備齊。[LLVM](https://llvm.org/docs/CommandGuide/llvm-objdump.html) · [Ghidra 指南](https://github.com/NationalSecurityAgency/ghidra/blob/master/GhidraDocs/GettingStarted.md#building-native-components) |
| 執行 Linux ELF／指定 glibc | 兩端均可直接跑靜態 x86 ELF。動態 ELF 用 QEMU `-L` 指向同架構 sysroot，放入相符的 loader、glibc 與相依函式庫。i386 配 `qemu-i386` 和 32 位元函式庫。multiarch 可供應外架構套件；要求特定 glibc 時，按發行版、版本分開固定 sysroot。多個 x86 子程序及套件須共同運作時，整個 amd64 映像較省事。[Ubuntu 24.04 手冊](https://manpages.ubuntu.com/manpages/noble/man1/qemu-x86_64.1.html) · [QEMU](https://www.qemu.org/docs/master/user/main.html) |
| 動態除錯 | Mac 的 Rosetta 路徑有一般 GDB 除錯失敗記錄，亦有經遠端 debug server 成功的個案；不能據此保證一般 `ptrace` 相容。兩端較可重現的選項是 QEMU `-g` 搭 ARM64 `gdb-multiarch`，在隔離會話內對自寫程式下斷點、單步、讀值。需要驗證原生 `ptrace` 語義時用 x86_64 Linux。[Docker issue #6921](https://github.com/docker/for-mac/issues/6921) · [Ubuntu QEMU 手冊](https://manpages.ubuntu.com/manpages/noble/man1/qemu-x86_64.1.html) |
| Windows／Android 動態執行 | Windows PE 另需 Windows 客體或相容執行環境。Android 在 Mac 宿主直接跑 `arm64-v8a` AVD 可硬體加速；x86 系統映像無同架構加速，宜用 x86 宿主。Google 明列 Docker 等 VM 內不支援加速 AVD，本機巢狀 KVM 未確認。Linux ARM64 有從原始碼建置 emulator、以 KVM 跑 ARM64 映像的紀錄，須有 `/dev/kvm` 使用權；現行 Android Studio 安裝頁仍未支援 Linux ARM CPU。[Android 加速](https://developer.android.com/studio/run/emulator-acceleration) · [Emulator 發行記錄](https://developer.android.com/studio/releases/emulator) · [Studio 支援平台](https://developer.android.com/studio/install) |

**速度與逾時要分開量。** 一筆 M1 Max、Desktop 4.15 的四執行緒 CPU 測試，原生 ARM／實驗性 Rosetta／QEMU 約為 30,333／25,567／1,068 events/s；同一工作量約耗時 1／1.2／28 倍。這是單項歷史測量，兩種宿主的 GDB 單步與服務延遲倍率均查不到。本地 amd64 題目服務已靠模擬運行；ARM 工具透過網路連它時，服務回應變慢仍會消耗 job 的 60 秒預設期限（上限 600 秒，另受剩餘預算限制）。應分記服務就緒、請求等待與工具運算，再判斷哪一段逾時。[測量原文](https://github.com/docker/for-mac/issues/6641) · [本地映像記錄](../../local-challenges.md) · [job 契約](../specs/2026-10-23-design-v1-g-solver-minimal.md)

### 3．映像選擇與既有專案

首選 **ARM64 原生工具＋QEMU＋固定 x86 sysroot**，將 Pwn、Reverse、Mobile 工具納入建置。Ubuntu 的 ARM64 `qemu-user` 套件約 11.7 MB 下載、101 MB 安裝，另計 sysroot、除錯器與工具。第二個 amd64 成品適合相依套件多或只能取得 x86 工具時使用；代價是多維護一套建置、下載與驗證，在 Linux ARM64 還依賴宿主註冊。兩案都應固定映像 digest 與套件快照，成品大小待量。[Ubuntu 套件頁](https://packages.ubuntu.com/noble/arm64/qemu-user)

公開成品不足以概括為「多數只出 amd64」。Cybench 在 2024-09-13 同時發布 amd64／arm64，壓縮大小為 19.08／6.93 GB；EnIGMA 所查標籤只列 amd64。D-CIPHER 的 Dockerfile 明寫 amd64 套件及 i386 相依；HackSynth README 查不到宿主架構承諾。這些資料只證明發布或建置選擇。[Cybench](https://hub.docker.com/r/cybench/cybench/tags) · [EnIGMA](https://hub.docker.com/r/sweagent/enigma/tags) · [D-CIPHER](https://raw.githubusercontent.com/NYU-LLM-CTF/nyuctf_agents/main/docker/multiagent/Dockerfile) · [HackSynth README](https://github.com/aielte-research/HackSynth)

### 4．最小驗證與通過條件

兩種 ARM 宿主各用同一版本的自寫加法程式，產生 amd64 靜態、amd64 動態及 i386 動態三份。**通過條件**為非 root、無 Docker socket、離線取得正確輸出及退出碼；動態版載入指定 glibc；GDB 命中具名函式、單步後讀到預期值；刻意逾時後無殘留程序。分記映像下載量、冷建容器、暖執行、首個斷點與自寫 amd64 服務回應時間。相同短作業須在預設 60 秒內完成，另列原生 x86 對照（若可用）。

本次僅只讀調研。建置、下載、執行 Docker、修改宿主註冊或使用遠端機均待另行授權。來源等級：除 HackSynth **只讀 README** 外，上列均為**已讀原文**；issue 數據屬回報者實測。本機 Rosetta 開關、兩端實際效能、工具成品大小與 Agent 使用效果仍未驗證。

