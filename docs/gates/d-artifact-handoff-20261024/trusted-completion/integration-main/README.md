# D4/D5 主工作區接入驗收

2026-10-24，使用者授權接入主區，接入驗收時未commit/push。接入時來源為原型final-source；整理後以 [已驗來源manifest](../verified-source-hashes.json) 及 [還原patch](../verified-source.patch) 保留，原目錄已移除；31個非文檔源核對，僅13個差異文件複製，見source-transfer.json。另修正product/AGENTS.md過時的未接入說明，不變更機械接口。

主區定向43/43、全套403/403、typecheck/build皆exit0，見commands.json及日誌。同批十案最小證據見 [integration-main-native](../integration-main-native/)，每案records.jsonl可按 [證據README](../README.md) 無損還原所選原文件；acceptance.json保留驗收結果；native-command.json記錄harness exit0。30個同批來源hash一致；候選原bytes與裁判實收及保存記錄一致。deadline/budget內層exit1為預期。覆蓋拒絕原生送回Engineer、無裁判、不可用結果、真socket丟回复、自然停止競爭、預算拒絕；沒有跨run拼接成功。

獨立只讀審查無阻塞，文案殘留見review.md。只證明主區機械接線；不證明真模型能力、Verifier語義、真實裁判部署/秘密隔離、任意同uid並發或跨重啟恢復。產品真模型調用0，usage unavailable。原有失敗證據不變，未放寬design限制。

證據精簡保留各案原生訊息、job/固定包/驗證/提交狀態、原bytes、wire及observations，audit保留相關事件；完整Provider/events/workspace等重複轉儲已移除。此次整理不重跑原生十案，不改寫上述歷史來源hash或驗收結論。
