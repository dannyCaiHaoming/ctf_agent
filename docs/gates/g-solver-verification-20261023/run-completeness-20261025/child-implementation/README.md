# 后台关联实作证据

从详细design §10进入；先读report.md与review.md，再按需读native-verification.json及单案metadata.json。fix.patch是相对本次实际dirty输入的增量，input-hashes.json与change-manifest.json固定来源；不以隔离工作区HEAD代替输入。

主区验收见main-typecheck/build/test.log；最终全套49文件458项。原生运行固定OpenCode1.19.3、仅本地确定性provider，两案各同child两轮，无observer。native-probe.ts复现时需调整其中工作区／审计路径，并使用isolation.sb；禁止据此调用真实provider。保留失败日志，旧456项记录不是最终计数。

原始运行目录已清理，历史runDir不是现存证据链接；只保留脱敏消息／审计投影，不保存原始transcript/reasoning/凭据。该目录是已有验证资料中的证据，不是新增运行gate。
