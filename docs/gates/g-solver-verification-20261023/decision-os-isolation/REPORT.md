# G OS 隔離：機制成立，產品部署仍受阻

2026-10-23（Asia/Tokyo）。工作區：`/Users/caihaoming/.codex/worktrees/4fcd/pentest-agent`。只做本地非秘密 fixture；無真實產品模型、provider 或外部靶場調用。未修改主工作區／原型來源，未 commit、push、刪 plan 或歸檔。

## 判據、決定與待決事項

同一原生 ARM64 部署必須同時支持：本題 materials／published 可讀不可修改、自己的 work 可寫；他題／他會話 work 及控制狀態、provider／RPC／oracle 哨兵不可讀寫；他會話的 environ／memory／root／cwd 和 signal 不可訪問；宿主可發布、讀輸出及取消整組；CPU／記憶體限制實際觸發。不能用「全拒絕」或 fixture 通過代替非 root 產品宿主的部署能力。

| 候選 | 實測 | 決定／建議 |
| --- | --- | --- |
| a：每會話 uid、每題唯讀群組 | 開發者以 Docker exec 注入 uid 2101／2102（同題，gid 3101）與 2201（異題，gid 3201）後，三會話邊界成立。但 uid 1000、cap=0 宿主的 setgroups／setgid／setuid／spawn 其他 uid 四項全退出 1／EPERM，向會話程序組 TERM／KILL 亦 EPERM | 在目前權限契約下不採用。外部注入 uid 不是非 root 宿主啟動成功，建置時建立帳號也不提供運行時身份切換 |
| b1：非 root user／mount／PID namespace | 公開 unshare 的 user-only 和 user＋mount＋PID 全退出 1／EPERM，cgroup.procs 寫入亦拒絕 | 本次預設 Docker 部署不可用；未放寬 seccomp、未加 SYS_ADMIN、未改宿主策略。未據此斷言所有 rootless runtime 都不可行，亦未把 EPERM 歸因到單一內核／策略層 |
| b2：每會話獨立容器、子目錄掛載與獨立 PID 視圖 | 同一最終 run-4 完成兩題、同題雙會話，正反向文件／進程／控制哨兵邊界、發布／輸出、資源限制及開發者端整容器停止 | **隔離機制可行，產品方案未選定。** 產品宿主自身無容器生命週期入口，跨 PID namespace 直接 kill 亦拒絕；本次由開發者端 Docker 完成啟停 |

建議主 session 優先保留 b2 作為隔離機制方向，但先決定產品外生命週期由誰負責、權限／狀態／取消如何與現有宿主相接。這會新增部署責任，本項沒有批准或實作該架構。若維持單一非 root 容器、無外部控制入口，此部署仍是產品作業隔離阻塞；不可退回同 uid 共享文件與進程視圖。沒有擴展相鄰 D/E/F、配額或作業網路 scope。

## 最終同批證據

只認 [run-4 摘要](run-4/summary.json) 與 [完整命令、退出碼及輸出](run-4/commands.jsonl)，不拼接先前批次。每個命令另有同名 JSON。

- 原生 Ubuntu 24.04、aarch64、kernel `6.12.76-linuxkit`，Docker Desktop 4.78.0／Engine 29.5.3。Python 3.12.3、util-linux 2.39.3-9ubuntu6.6，詳見 [套件版本](run-4/fixture-package-versions.json)。Ubuntu 基底 digest `sha256:68ee22004a9109b44973313b02ff7b1de250f1de0f5ecb628d73f579aaff33ac`。
- 驗證 image ID：`sha256:e55e891f83005c07295a805a1c8a6642839396e460f643c565851e5608d0d64a`，保留標籤 `gdec-os-isolation-fixture:verified-4fcd`。最終 run 前已凍結探針／Dockerfile hash，與容器實測綁定。
- 候選 host／session 均非 root、CapEff=0、no-new-privileges、預設 seccomp、無 Docker socket。b2 根文件系統唯讀，本題 materials／published 子掛載唯讀、本會話 work 子掛載可寫；network=none。[權限能力與 namespace](run-4/a-nonroot-privilege.json)、[b2 uid／cap／掛載](run-4/b-inventory-a1.json)、[容器設定](run-4/inspect-b-a1.json)。network=none 只隔離此 fixture，不證明產品能連授權目標又拒絕其他網路。
- a 與 b2 各測 a1／a2／b1，每會話 7 項正向、39 項拒絕符合預期；記錄實際 mode／uid／gid、錯誤碼與掛載。自身 environ、memory 正向讀取成功；他會話進程拒絕不是讀取機制全壞。b2 使用 Docker inspect 的 Linux 外層 PID 探測，另記 namespace PID，沒有把他容器 PID 1 當成自己 PID 1。[a1](run-4/a-boundary-a1.json)、[a2](run-4/a-boundary-a2.json)、[b1](run-4/a-boundary-b1.json)、[b2-a1](run-4/b-boundary-a1.json)、[b2-a2](run-4/b-boundary-a2.json)、[b2-b1](run-4/b-boundary-b1.json)。
- 同 uid＋共享根的 [反例](run-4/negative-control-same-uid.json) 成功直接讀五個控制／跨會話／跨題非秘密哨兵；環境白名單不能當作 OS 隔離。這是機制反例，沒有冒稱運行產品 JobManager。
- b2 host 發布新文件，會話從原唯讀掛載讀到；host 讀到三會話輸出文件；兩題四份 materials／published 原值不變。[發布／讀輸出](run-4/b-host-publish-read-output.json)、[讀新發布](run-4/b-session-read-new-publication.json)、[原值檢查](run-4/b-content-unchanged.json)。actor stdout 另由開發者 Docker logs 保存，不是已接入產品的輸出管線。
- 同一 b2-a1 容器 `cpu.max=50000 100000`；nr_throttled 從 0 增至 19，throttled_usec 從 0 增至 949275。RLIMIT_CPU soft/hard=1／2 秒，實際 SIGXCPU、退出 **152**。memory.max=134217728，實際分配並觸頁至 OOM、退出 **137**，oom_kill 從 0 增至 1。[CPU](run-4/b-cpu-limit.json)、[記憶體](run-4/b-memory-limit.json)、[之前](run-4/b-resource-before.json)、[之後](run-4/b-resource-after.json)。0.5 CPU、128 MiB、48 pids 等都是探針值，不是產品預設；節流不是累計 CPU 硬預算，記憶體限額不是磁碟寫入配額。
- OOM 後 [停止前 top](run-4/b-process-tree-before-stop.json) 仍見父／子在同一程序組並忽略 TERM。開發者端 stop 等 1 秒後整容器退出 137、PID=0，top 退出 1；其他兩會話仍 running。[停止](run-4/b-developer-controller-stop.json)、[停止後](run-4/b-inspect-stopped.json)、[a2 存活](run-4/b-peer-alive-a2.json)、[b1 存活](run-4/b-peer-alive-b1.json)。inspect 的 OOMKilled 是之前 OOM 的保留旗標，不能單靠它推斷取消原因；停止前存活快照、stop 命令與終態共同支持此結論。[產品宿主直接取消缺口](run-4/b-product-host-direct-cancel.json) 另保留 ESRCH。

## 權限、失敗與限制

建置時以 root 安裝依賴／建立測試用戶；初始化容器短暫用 root＋CHOWN／FOWNER／DAC_OVERRIDE 建立合成資料所有權。這是開發者側 fixture 預備，所有候選運行均非 root、cap=0。Docker daemon 與開發者 Docker 權限的存在，正是 b2 尚缺部署決策的依賴，不能藏在 fixture 下。

- HTTP 軟件源兩次構建超時後取消（130）；`build.log` 含前一次取消進程交錯寫入的尾部，不能精確還原兩次構建順序。HTTPS 首次因基底沒有 CA 證書包失敗（外層 1、apt 100）。加入 [公開 CA bundle 與 hash](ca-source.json) 後，保持 TLS 和 apt 簽名校驗，構建成功（0）。[退出記錄](execution-exits.json)、[最終構建](build-verified.log)。只在 run 外準備依賴，沒有改代理／VPN／防火牆。
- run-1 退出 1：fixture 父目錄 root 所有、0711，非 root host 枚舉返回空，b 的四文件斷言抓到失敗；a 當時 all(empty) 的內容檢查亦不足，不能算通過。修正父目錄歸 host uid 1000，增加 a 明確二文件斷言後重跑，沒有放寬會話私有目錄。[首輪失敗](probe-run-1.log)、[原始空結果](run-1/b-content-unchanged.json)。
- 首輪 image ID／命令／輸出保留，但沒有及時凍結首輪 runner hash；重建後舊 image 亦無法取回，取回嘗試退出 125 見 [歷史版本限制](historical/source.json)，不補造歷史源 hash。run-2 通過；run-3 補齊 mode／版本／源 hash 後通過。最終快取重建因 BuildKit provenance 改變 manifest-list digest，故固定 `verified-4fcd` 標籤，再做完整 run-4（0）；只認此批。
- 不是任意惡意程式逃逸審計；未驗 side channel、所有 rootless 路徑或所有發行版。未接線產品 JobManager／C/RPC／OpenCode；原型產品碼未變，因此沒有安裝 npm 依賴或重跑 typecheck／build／full suite。本項探針語法、fixture 構建及完整 OS 機制驗證已完成。

## 複核與來源

從本獨立工作區執行，輸出目錄必須不存在。保留鏡像可避免再次下載依賴：

```sh
python3 tests/manual/g-os-isolation-probe.py --image gdec-os-isolation-fixture:verified-4fcd --out /tmp/gdec-os-isolation-review-UNIQUE
```

需重建時：

```sh
docker build --pull=false -t gdec-os-isolation-fixture:review-UNIQUE tests/manual/g-os-isolation-fixture
python3 tests/manual/g-os-isolation-probe.py --image gdec-os-isolation-fixture:review-UNIQUE --out /tmp/gdec-os-isolation-review-UNIQUE
```

Dockerfile 鎖基底 digest，CA bundle 按來源 hash 固定；未來 apt 套件可能更新，重建不能代替本批實測。腳本在 finally 只刪自己隨機 `gdec-os-isolation-*` 前綴的容器／volume，四次均核實無殘留；最終兩個命名 fixture 標籤保留供複核。不動其他任務資源，不改宿主帳號或全局配置。

基線 HEAD `d83a0c3024271dbf212db319e900fcf527e68b0f`。文檔來自主區，產品原型來自 g-c-rpc-slow-tools；[sources.json](sources.json) 記來源、大小與 sha256。20 個已變產品／測試文件對上來源 final-hashes；99 個複製原型文件最終與來源及複製時 hash 全一致，見 [最終核對](prototype-integrity-final.json)。初始主區 G design SHA256 為 `91a71b2a4b03e305588f4a33cd9537602e134e4b93a81436b4e44ba496ed0417`；來源 JobManager 為 `095b5cb41c1db5b0ff81f1d5d64377edabae47c59d9ecea085a6630b98e99ff0`。

本項只新增／修改 G design §3.4／5.4／9／10、手動探針與必要 fixture、此證據目錄。其他 git diff 是已授權的主區文檔／原型複製，不作本項產品修改同步。plan 保留供主 session 核對收口。
