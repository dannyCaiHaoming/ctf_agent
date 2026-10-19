# 当前配置与历史配置

CLI 默认使用 `release-profile.m1-opencode.example.json`，模型设置由其引用的 `opencode.m1.example.json` 提供。Provider 凭证仅通过 OpenCode 配置的环境变量引用注入。加载配置不证明余额或网络可用。

`release-profile.m1-td-bailian-20261019.json` 与 `opencode.m1-td-bailian-20261019.json` 是已完成的 b2 验收冻结配置；保留原字节，不因清理修改旧批次或恢复外部调用授权。

以下文件仅作历史证据，当前 loader/schema 已拒绝其直连模型格式：

- `release-profile.example.json`（旧 M0 stub 默认）
- `release-profile.m1.example.json`
- `release-profile.m1-bailian-deepseek-v4-flash.example.json`
- `release-profile.m1-t1-formal-20261019.json`（旧 b1）
- `release-profile.volcano.example.json`
- `release-profile.volcano-anthropic.json`
- `release-profile.volcano-payg.example.json`

这些文件被历史结果/冻结 manifest 引用，因此原位保留。新配置必须使用 OpenCode 格式；不要重新启用 JSON 动作协议。
