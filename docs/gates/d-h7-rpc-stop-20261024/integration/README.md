# H7 子區接入版本重驗

最終批 `integration-20261024-0958`，對照/R1/R2/R3 依序全部通過，exit 0。發布 1/1/0/1，各來源 job/publish 一次、資源全部 settled。每案的 provider-config、versions、原 bytes/state/workspace、C 證據、wire/observations/events 保留。跨 gate 的交叉核對與整體結果見 [D integration](../../d-artifact-handoff-20261024/integration/README.md)。

狀態僅為子區實現與無模型驗證，待主核對、未合併主區。R3 證明 native abort 丟棄遲到回复；不是插件收到後拒絕。模型 unknown 遵守、恢復/冪等/強制鎖均未證明或未實作。所有舊失敗保留。
