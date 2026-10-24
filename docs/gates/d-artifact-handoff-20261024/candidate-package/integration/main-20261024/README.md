# D 第二接口主区接入

2026-10-24：按用户授权将 9b7d 已主核对的13个产品/测试/角色文件逐项接入；transfer-manifest.json 保存前后hash。第一接口既有未提交依赖保留，未整份覆盖子区文档，未加入 D 后三接口或延后项。

主区 npm run typecheck、npm run build、npm test 均 exit 0；全套362/362。最终原生命令 `npx tsx tests/manual/d-candidate-package.ts integration-main-20261024` 同一批四场景 exit 0，提交数1/1/0/1；每案两job/一次整包请求，无盲目重发。日志与退出码在本目录；原始runtime在 ../../integration-main-20261024/。audit.json 核对源hash、真实发布bytes、候选/依赖、实际加载正文及资源收束。

原型、子区验收、权限失败与其他历史失败保留。只确认无模型程序接入，实际包重放、Verifier、可信判定、语义充分性及真实模型协作未验；不能称 D 整体完成或 solved。H1/H5/H7 限制不变。

收口：完成 plan 已清理，第二接口验证/实现两个聊天已归档。原生 archive_worktree 拒绝移除 ae52/9b7d（primary checkout），两工作树保留；见 cleanup.json。原始日志与CRLF测试bytes保持原样，不为消除 diff whitespace 警告改写证据。
