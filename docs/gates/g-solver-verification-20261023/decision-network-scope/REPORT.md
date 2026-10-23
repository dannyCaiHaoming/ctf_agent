# G 作業網路 scope 候選驗證

日期：2026-10-23（Asia/Tokyo）。本項驗證與 design 回寫已完成；**完整產品網路 scope 未通過、仍未定稿**。建議優先考慮 namespace 預設拒絕作底層，不能把本輪封包層成功當成產品已完成隔離。

## 判據與結果

同一 `accepted/` 批次完成四組，每組 35 個探針；探針程序退出 0 表示預期的成功、拒絕和設計反例均重現，**不是完整 scope 通過**。完整結果見 [result.json](accepted/result.json)、[對照矩陣](matrix.tsv)、[原始命令及退出碼](accepted/commands.json) 和 [獨立於探針斷言的核對](review-checks.json)。JSON 的 `reachable` 表示該探針取得成功回應；代理的 HTTP 403 也記 false，並不表示連不到代理 socket。

| 檢查 | 僅 proxy 環境 | namespace 固定 IP／port | DNS 改為越界 IP | 只准 HTTP proxy socket |
| --- | --- | --- | --- | --- |
| 授權 TCP 8080、UDP 9000、IPv6 TCP／UDP | 可用 | 可用 | 字面地址仍可用 | 直接連線被阻止 |
| 他題、控制替身、未授權地址；TCP／UDP、curl 清除代理、IPv4-mapped IPv6 | 可繞過代理直連 | 阻止 | 阻止 | 阻止 |
| 宿主非秘密哨兵（正向可達的宿主地址） | 可達 | 阻止 | 阻止 | 阻止 |
| 其他端口、非指定 DNS resolver | 可達 | 阻止 | 阻止 | 阻止 |
| 目標名稱解析後的 TCP | 可用 | 可用 | resolver 回越界 IP，連線阻止 | DNS 不通 |
| 同 IP／port 的另一 origin；同 origin 管理路徑 | 可達 | **仍可達** | **仍可達** | 另一 origin 拒絕；同 origin 管理路徑仍可達 |
| 跨 IP redirect | 直接跟隨可達；經代理拒絕 | 下一跳阻止 | 下一跳阻止 | 代理拒絕 |
| 授權目標 HTTP 代理請求 | 成功 | 代理 socket 被擋 | 代理 socket 被擋 | 成功 |

固定規則放行：`172.30.231.10:8080/tcp`、`:9000/udp`，IPv6 `fd25:d3:231::10` 的相同端口；固定本地 DNS 替身 `172.30.231.53:53/udp`。他題 `.20`、控制替身 `.30`、其他地址 `.99`、另一 DNS `.54`、代理 `.40:3128` 均為本次專用容器。DNS 改址只把 `.53` 的回答從 `.10` 改成 `.20`，不改防火牆。所有測試流量都去本地 fixture 或本任務宿主哨兵，沒有真實模型、provider、外部靶場或公共地址探測。

他題、控制替身、未授權服務和另一 DNS 在限制前均正向可達；它們以及宿主哨兵在三組限制後的日誌與基線完全相同，15 項核對通過。宿主 loopback 哨兵另在宿主上回 200；作業 namespace 的 `127.0.0.1` 不是宿主 loopback，連線被拒絕。gateway 地址沒有對應正向服務，只記觀察，不以其超時單獨證明阻斷。

## 決定、建議與未定項

- **淘汰「只設 proxy 環境」作獨立隔離。** accepted 每組容器都明確帶 `http_proxy`、`HTTP_PROXY`、`ALL_PROXY`；Python socket 不理會它們，curl 可清除變數或使用 `--noproxy`。其配置與直連成功同批保存。
- **甲的封包機制可行。** 不經自訂 HTTP 工具的 TCP、UDP、IPv6 與映射地址受同一 kernel 規則限制；DNS 解析成功不會新增 IP 授權。建議作底層候選，尚未選為已整合產品方案。
- **本輪強制 HTTP 代理僅局部可用。** origin 比對及跨 origin redirect 拒絕成立，但沒有普通 TCP／UDP 直連能力。本 fixture 的 CONNECT 直接 403；沒有驗 HTTPS、SOCKS 或透明代理，不能據此否定所有代理組合。
- **完整 scope 仍不通過。** IP／port 規則無法區分不同 origin 共用的地址／端口，也無法辨認同 origin 管理路徑。不得把 `target` origin 靜默擴成 IP／port 授權。同 origin 受保護操作交 D／E 的可信描述，本項不新增端點分類。

主會話需要判斷兩項：一是可信網路 scope 如何表達、來源何在、控制／oracle 服務是否必須與目標地址分離；若要保持嚴格 origin 語義，哪些協議層方案仍需比較。二是如何與 OS 隔離方案接合，由可信佈建側創建／配置執行環境，同時維持產品與作業非 root、無 Docker socket。這些是設計待決項，本次沒有默稱已獲批准。

## 權限、版本及相容性

Docker 29.5.3／Docker Desktop 4.78.0，Linux 6.12.76-linuxkit，`aarch64`；Ubuntu 24.04 ARM64，Python 3.12.3、curl 8.5.0（Ubuntu 8.5.0-2ubuntu10.16）、iptables/ip6tables 1.8.10（nf_tables）。具體包版本見 [versions.txt](accepted/versions.txt)，映像不可變 ID 和基礎映像 digest 位於 commands.json 的 image inspect 輸出。

可信 namespace anchor 以 root、只加 NET_ADMIN 配置自己的規則；沒有使用 host network、host 防火牆修改或 Docker socket 掛載。實際探針是獨立容器，共用該 namespace，uid/gid **65532:65532**、capability 全空、`no-new-privileges=1`、唯讀根目錄、僅暫存 tmpfs，沒有 Docker socket。四組的 `/proc/self/status` 和 container inspect 均核對；修改 iptables 與建立 raw socket 均以非零退出碼拒絕（[權限檢查](accepted/identity.json)、[改規則拒絕](accepted/rules-denied.json)、[raw socket 拒絕](accepted/raw-denied.json)）。

此佈局可與獨立會話執行容器相容，網路 namespace 不要求分享 PID／檔案 namespace；但這是本輪配置事實，不是第 5.4 節 OS 隔離整體通過。沒有修改 JobManager 或接入 C 的 session／challenge 綁定，沒有驗動態建立與回收競態、角色無目標網路配置、scope 更新後的既有連線撤銷，亦沒有做瀏覽器、真實 VPN／遠端、TCP DNS、TLS／CONNECT 或經授權目標轉送流量的驗證。固定 UDP DNS 替身不代表生產 resolver；合法換址及無任意公共 DNS 轉發的方案待設計。

## 失敗與證據歸屬

- 工具鏡像準備遭遇容器外連不穩：初次中斷的退出碼不可得，第二、三次主動中斷均保留實際 130。後來的臨時下載轉發器少了 Content-Length，APT 取得 0 bytes；[最小重現](relay-framing-reproduction.json) 對比補齊長度後取得 2300 bytes。該次 build 外層退出 1、APT 100；沒有停用簽名或哈希校驗。最終 build 退出 0；52 次 Ubuntu 依賴下載中有一次 curl 52，APT 重試後完成，全部保留於 dependency-downloads.json。轉發器只准 `ports.ubuntu.com/ubuntu-ports/`，只用於 run 外準備，build 後已關閉，沒有改宿主代理設定。
- `attempt1/` 四組機制探針退出 0，但評閱發現代理變數只在 curl 呼叫側構造，未明確傳入 Python 進程；其來源與限制保留。`accepted/` 將代理變數放進容器環境後，**完整重跑同四組**，不拼接兩批結果。
- 本次只做文檔與容器手動探針；20 個導入的原型文件全部保持來源 hash，見 [原型保留核對](prototype-preservation.json)。未改產品代碼，沒有重跑 typecheck/build/npm 全套，不將歷史 291 項結果當作本輪驗證。Python 語法檢查及文檔差異檢查另留結果。沒有真實模型調用；模型 usage 為 `unavailable`，不填估計值或 0。
- 作者完成探針、配置、服務端日誌與來源 hash 的自查；主會話的獨立核對尚未完成。

來源：基線 `d83a0c3024271dbf212db319e900fcf527e68b0f`。文檔來自主工作區；原型來自指定的 g-c-rpc-slow-tools 工作區，先按該區 diff／untracked 和 final-hashes 核對 20 項再複製。完整清單在 [input-sources.json](input-sources.json)，最終文件在 final-hashes.json。原型 `job-tools.ts` SHA-256 為 `095b5cb41c1db5b0ff81f1d5d64377edabae47c59d9ecea085a6630b98e99ff0`。只改自己的工作區，沒有 commit、push、合併、刪 plan 或歸檔；本輪容器與 network 均已清理（[cleanup](accepted/cleanup.json)），保留本任務工具 image 供復核。

## 可復核命令

工作區：`/Users/caihaoming/.codex/worktrees/25d3/pentest-agent`。

```sh
# 已有本任務工具 image 時，只需運行本地對照（輸出另存，避免覆蓋 accepted）
python3 tests/manual/g-network-scope-probe.py docs/gates/g-solver-verification-20261023/decision-network-scope/review-run
# 需要重建工具 image 時：此準備只訪問 Ubuntu 官方依賴來源，臨時 relay 結束後關閉
python3 tests/manual/g-network-scope-fixture/prepare-image.py
python3 -m py_compile tests/manual/g-network-scope-probe.py tests/manual/g-network-scope-fixture/*.py
git diff --check
```

探針與 fixture 源碼另按原路徑存於 `probe-source/tests/manual/` 供長期核對；`accepted/commands.json` 保留每條實際 Docker 命令、輸出和退出碼。重建會重新解析軟體源版本，本輪結論只綁已記錄的 image ID／包版本；不能把重建結果視為本輪同一批次。
