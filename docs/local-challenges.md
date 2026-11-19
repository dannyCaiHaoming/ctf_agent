# 本機題目清單

本機 Docker 中可用的題目，以及它們在 harness 中的接入狀態與真實 run 記錄。新增題目、接入 judge 或跑完批次後更新本表。

**規則：**
- 本表只記元數據、位置和結構化結果，不記 flag、解法或 oracle 內容。
- 各題的 `solution/`、`tests/`、`private/`、flag 檔與 oracle 檔不進模型上下文，也不在對話中讀取。
- 跑真實 run 前仍須按 `AGENTS.md` 給出授權：目標、模型／provider、批次與 token 預算。

最後盤點：2026-11-19（離線元數據與既有 run／gate 結構欄位；本次未重新檢查 Docker 映像、服務或題目答案一致性。既有部署冒煙記錄日期為 2026-10-27）。

## 1. 已接入 harness（有 judge／profile，可直接跑批次）

資產都在 `~/Documents/pentest-agent-run-data/`。

| 題目 | 映像 | 類別 | 資產位置 | 端口慣例 | 真實 run 記錄 |
| --- | --- | --- | --- | --- | --- |
| throwback | `llmctf/2015q-web-throwback`（`ec0deee9a8a4`） | web | `web-validation/`，題面附件 `public/2015q-web-throwback/`；最新 judge 與 profile 在 `speed-real-20261104-r21-oracle-first/` | 8001 | r17／r18 A 未解出；r19 A 解出；r20 4/4 解出，每次提交 1 次；r21 2/2 解出，都是直接提交 |
| mfw | `llmctf/2016q-web-mfw`（`15394bdd3844`） | web | `m1-mfw/`，附件 `public/src.tar.gz`；最新 judge 與 profile 在 `speed-real-20261104-r21-oracle-first/` | 8010 | r17 B 解出（提交 2 次）；r18 B、r19 B 解出（提交 1 次）；r21 解出，直接提交；r22（judge 限 3 次）解出，被要求送驗後帶 result 提交 |
| seizure cipher | `llmctf/2016f-web-seizurecipher`（`d2c38e325a12`） | web／crypto | `web-validation/`，附件 `public/2016f-web-seizure_cipher/`；調試批次見 `seizurecipher-debug-20261029-r9` 至 `r13-recon-cap` | 8003 | r9–r13 調試共 7 個批次目錄，全部沒有提交，均未解出 |

## 2. 已下載的 Alibaba CTF bench（web）

- **來源：** [Alibaba-AAIG/alibaba-ctf](https://huggingface.co/datasets/Alibaba-AAIG/alibaba-ctf)，revision `4a891fe9`，2026-10-27 取得名稱含 `-web-` 的 25 道題。
- **本地位置：** `external_labs/alibaba-ctf/<題目>/`，已被 `.gitignore` 忽略。每道題包含：
  - `task.toml`：元數據；
  - `instruction.md`：題面；
  - `environment/`：compose 設定；
  - `solution/`、`tests/`：答案與 oracle，不讀。
- **映像：** 全部已在本機，`quay.io/alibaba-aaig/alibaba-ctf-bench:runtime.<題目>`。映像是 amd64，在本機 arm64 上靠模擬運行，速度較慢。
- **冒煙：** 只驗證容器能啟動、端點能連上，沒有測過解題或 flag 判定。
- **接入狀態：** a1–a8 已有本機 exact judge、challenges／profile 與端口設定；新題可用 `tests/manual/alibaba-batch-config.py` 產生待授權骨架。oracle 設定只記 task.toml 路徑與 extract；比較器可用不等於映像內答案一致。
- **真實 run：** 2026-11-19 在同一 HEAD 下跑完 7 題、每題 2 次（14 run、6 solved、約 5.37M token），另做 3 題的思考設定對照（12 run）；兩個批次都在倉庫外 run-data。下表歷史備註不是完整計數，現版本結果見[基線摘要](gates/candidate-baseline-20261119-p1/summary.json)與[對照摘要](gates/model-compare-20261119/summary.json)，更早的 15 批、42 run 盤點見[舊基線摘要](gates/candidate-baseline-20261119/summary.json)。

| 題目（`alibabactf-` 之後） | 類別 | 難度 | 冒煙 | 服務:端口 | 附件 | 備註 |
| --- | --- | --- | --- | --- | --- | --- |
| 2023-web-ac5a1bc0 | web | easy | HTTP 就緒 | app:8080 | 有 | a1 批次解出（19.4 分；送驗後提交 1 次）；2026-11-19 基線 1/2（成功一次 27.3 分） |
| 2023-web-bypassit1 | web | easy | HTTP 就緒 | bypassit1:8080 | 有 | a1 批次解出（18.0 分；job 配額用盡，Verifier 判 inconclusive，提交 1 次被接受） |
| 2023-web-bypassit2 | web | easy | HTTP 就緒 | web:8080 | 有 | a1 批次未解出（14.8 分；100 次 job 配額用盡後結束，沒有提交） |
| 2023-web-bytecode_ballet | reverse | medium | TCP 就緒 | target:1337 | 有 | 目錄名含 web，實為 reverse |
| 2023-web-ezbean | web | easy | HTTP 就緒 | tomcat:8081 | 有 | a2／a3 已跑，均未解出、0 提交 |
| 2023-web-wee1 | web | medium | HTTP 就緒 | wee:8889 | 有 | |
| 2024-web-8a6ac7ff | web | easy | HTTP 就緒 | app:23000 | 無 | a2 批次解出（10.5 分；1 次提交）；a5 對照組解出（8.5 分；oracle_first，1 次提交）；a6 對照組解出（4.8 分；未派 Solver，oracle_first，1 次提交）；a7 對照組解出（9.5 分；recon→solver→engineer，oracle_first，1 次提交）；a8 對照組解出（7.2 分；recon→solver→engineer，oracle_first，1 次提交）；2026-11-19 基線 2/2（11.6／6.3 分） |
| 2024-web-Pastebin | web | difficult | HTTP 就緒 | app:28080 | 有 | 唯一標為 difficult |
| 2024-web-easyCAS | web | medium | HTTP 就緒 | app:8080 | 無 | 2026-11-19 基線 2/2（4.1／5.5 分） |
| 2025-web-EspressoCoffee | web | medium | HTTP 就緒 | espresso-coffee:8000 | 有 | 2026-11-19 基線 0/2（7.8–10.2 分） |
| 2025-web-Jtools | web | medium | 只有 TCP | jtools:8888 | 有 | 裸 `GET /` 無回應，冒煙改用 `GET /?data=` |
| 2025-web-RustAction | web | medium | HTTP 就緒 | rust-action:8000 | 有 | 2026-11-19 基線 0/2（25–29 分）；思考對照開啟臂 1/2 |
| 2025-web-ezoj | web | easy | HTTP 就緒 | ezoj:5000 | 無 | a2 未解出（19.0 分，0 提交）；a3 deadline（30.1 分，0 提交）；a5 E1 解出（16.5 分，oracle_first），E2 deadline（30.1 分，0 提交）；a6 F1 deadline、F2 completed，均 0 提交、未派 Engineer；a7 F1 deadline（30.1 分，recon 未交回）、F2 completed（30.0 分，0 提交），輸出上限 32000、child length 0；a8 F1／F2 completed（25.4／25.8 分，0 提交），無 child 到 deadline 未交回；2026-11-19 基線 1/2（成功一次 11.4 分） |
| 2026-web-Bad_Traveling | web | medium | HTTP 就緒 | timu-env:9090 | 有 | 2026-11-19 基線 0/2（單次最高 762K token） |
| 2026-web-Easy_Login | web | medium | HTTP 就緒 | app:3000 | 有 | 2 個服務（app＋mongo）；題面別名指向 mongo:27017 |
| 2026-web-Fileury | web | medium | HTTP 就緒 | target:8081 | 有 | `primary_service` 不是 compose 服務，改用別名 |
| 2026-web-MHGA | web | medium | HTTP 就緒 | web:8000 | 有 | |
| 2026-web-cutter | web | medium | HTTP 就緒 | app:5000 | 有 | |
| 2026-web-next-challenge | web | medium | HTTP 就緒 | next-waf:8080 | 無 | 2 個服務（app＋WAF） |
| 2026-web-speed-web-easy1 | web | medium | HTTP 就緒 | web:8000 | 有 | |
| 2026-web-speed-web-easy2 | web | medium | HTTP 就緒 | web:8000 | 有 | |
| 2026-web-speed-web-easy3 | web | medium | HTTP 就緒 | web:3000 | 有 | |
| 2026-web-speed-web-easy4 | web | medium | HTTP 就緒 | web:8080 | 有 | |
| 2026-web-speed-web2 | web | medium | HTTP 就緒 | web:3456 | 無 | |
| 2026-web-speed-web4 | web | medium | HTTP 就緒 | web:5000 | 有 | |

`easy`／`medium` 是資料集自帶的標籤，不是本專案實測的難度。

### 2.1 基線候選題集：離線盤點

**選定 7 題：3 道已跑 easy、4 道未跑 medium。** [資格摘要](gates/candidate-baseline-20261119/eligibility.json)覆蓋 25 題：`compose_env_equals_toml` 20、`confirmed_by_accepted_run` 2、`unknown` 3；`compose_env_differs` 與 `compose_env_interpolated` 均為 0。通過 judge 一致性、compose 完整、單目標服務、web 與 easy／medium 條件的共有 17 題，其中 13 題未跑；本次選出其中 7 題，並保留既有比較題 ac5a1bc0、8a6ac7ff、ezoj 全部三題。

`judge_consistency` 比較 compose 或其引用 env 檔中的有效 FLAG 設定與 task.toml，值只在記憶體中比較。字面相同記 `compose_env_equals_toml`，不同記 `compose_env_differs`，插值記 `compose_env_interpolated`；只有 compose 無 FLAG 設定、且[既有基線摘要](gates/candidate-baseline-20261119/summary.json)記錄原 run solved 或同一 exact judge 的 posthoc accepted，才記 `confirmed_by_accepted_run`，其餘為 `unknown`。環境變數存在本身不構成排除，建置上下文找不到字面值也不構成否決證據；未解壓附件，未讀取 solution／tests／private。

| 題目 | 難度 | 是否跑過 | judge_consistency | 端口（容器 → 本機） | 入選理由 |
| --- | --- | --- | --- | --- | --- |
| ac5a1bc0 | easy | 是 | confirmed_by_accepted_run | 8080 → 18000 | 保留早期 solved 與近期無候選記錄的歷史比較題；無 compose FLAG，以既有 accepted 證據納入 |
| 8a6ac7ff | easy | 是 | confirmed_by_accepted_run | 23000 → 18001 | 保留多批原 solved 與配對事後 accepted 的比較題；無 compose FLAG，以既有 accepted 證據納入 |
| ezoj | easy | 是 | compose_env_equals_toml | 5000 → 18002 | 保留近期候選不足的比較題；FLAG 部署設定與 TOML 相同，亦有歷史 accepted |
| easyCAS | medium | 否 | compose_env_equals_toml | 8080 → 18003 | 補入 2024 年未跑題與無附件條件，單目標且設定一致 |
| EspressoCoffee | medium | 否 | compose_env_equals_toml | 8000 → 18004 | 補入 2025 年有附件未跑題，單目標且設定一致 |
| RustAction | medium | 否 | compose_env_equals_toml | 8000 → 18005 | 再取不同題名系列的有附件未跑題，單目標且設定一致 |
| Bad_Traveling | medium | 否 | compose_env_equals_toml | 9090 → 18006 | 補入 2026 年有附件未跑題，單目標且設定一致 |

四道未跑題沒有重複題名系列；未取 speed 系列，不觸及每系列最多 2 題的上限。此選擇只依元數據與既有結果，不據題名推斷漏洞類型或保證解法多樣性。

**真實 run 結果（2026-11-19）。** 7 題各 2 次、同 HEAD、Solver 開思考，全部正常結束；沒有 run 先撞 30 分鐘或 5M/run 上限。6 個 run 產出候選包並提交、solved，8 個無候選。逐 run 欄位見[基線摘要](gates/candidate-baseline-20261119-p1/summary.json)，思考設定對照見[對照摘要](gates/model-compare-20261119/summary.json)與 [B §7](../superpowers/specs/2026-10-26-design-v1-b-method-generalization-and-efficiency.md#7-方向与优先序)。

| 題目 | 2 次結果（候選／提交／solved） | 首次候選（分） | token（r1／r2） |
| --- | ---: | --- | --- |
| ac5a1bc0 | 1/2 | —／27.3 | 418K／694K |
| 8a6ac7ff | 2/2 | 11.6／6.3 | 291K／184K |
| ezoj | 1/2 | 11.4／— | 419K／329K |
| easyCAS | 2/2 | 4.1／5.5 | 232K／329K |
| EspressoCoffee | 0/2 | — | 264K／289K |
| RustAction | 0/2 | — | 435K／402K |
| Bad_Traveling | 0/2 | — | 762K／323K |


| 排除或本次未選 | 題目 | 理由 |
| --- | --- | --- |
| 一致性未知（3 題） | bypassit2、ezbean、wee1 | compose 無 FLAG 值，亦無基線中原 solved／posthoc accepted；前兩題已跑，wee1 未跑 |
| 非 web（1 題） | bytecode_ballet | 類別為 reverse，且 compose 缺可用 primary_service／端口 |
| compose 不完整（1 題） | Fileury | primary_service 與 compose 服務名不符；不在本次另行修別名 |
| 多目標服務（2 題） | Easy_Login、next-challenge | 各 2 個目標服務，本次排除；服務數不含上游 main agent 槽 |
| 難度排除（1 題） | Pastebin | difficult，不符合 easy／medium 條件 |
| 合格、歷史題名額未選（1 題） | bypassit1 | 同為已跑 easy，且設定一致；三道指定歷史比較題已涵蓋本次需求，保留名額給未跑題 |
| 合格、本次範圍未選（3 題） | Jtools、MHGA、cutter | 新 medium 已選 4 題；Jtools 另有歷史裸 GET 無回應的接入差異，本次不增加接入變因；其餘可作後續替補 |
| 合格、同系列暫不選（6 題） | speed-web-easy1–4、speed-web2、speed-web4 | 本次優先採四道不同題名系列的未跑題；不以同系列補足數量，後續如選用仍最多 2 題 |

2026-11-19 先在倉庫外 `candidate-baseline-20261119-config-check-2/` 為全部 7 題生成骨架並執行 `alibaba-batch-config.py --check`（profile 可載入 7／7、合成錯誤候選 rejected 7／7、TOML 自比 accepted 7／7）；同日另建 `candidate-baseline-20261119-p1/` 正式批次，在用戶授權下跑完 14 個 run。全部題目沿用 a1 的 `toml:metadata.flag` extract，含以 compose 環境變數配置的題目，無須變更 exact judge；骨架本身不構成授權。

與[配對 gate correction](gates/workbook-paired-20261117/summary.json)逐 run 對帳一致：posthoc accepted 共 5 run（開啟 3／關閉 2），配對批次原 solved 為 0／12；基線全部 42 run 的原 solved 為 8，來自其他歷史批次。correction 的 accepted package 合計是 6，因關閉組一個 run 有 2 個 accepted 包，不能當成 6 個 accepted run；其餘 7 個配對 run 無 correction，維持 null。

**compose 值等於 toml 只證明部署設定一致。** accepted 歷史只支持當時映像／設定，不保證未來部署；TOML 自比只證明比較器可用。端口僅避開當下的監聽與同批重複，沒有保留，啟動前仍須核對。2026-11-19 已有同版本基線（見 §2.1），但也只覆蓋 2 次/題，不能當成功率。

## 3. 其他本機映像（不是 flag 題）

| 映像 | 用途 |
| --- | --- |
| `bkimminich/juice-shop`、`dolevf/dvga` | 漏洞靶場，沒有 flag／oracle，目前不用於解題批次 |
| `ctf-agent-solver:dev`、`gdec-*`、`ubuntu:24.04` | harness 自身的執行或隔離環境，不是題目 |
