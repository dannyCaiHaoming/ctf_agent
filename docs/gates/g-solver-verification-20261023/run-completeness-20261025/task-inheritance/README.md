# 创建方式补齐：历史结论摘要

2026-10-25 按用户要求清理本任务验证日志、原始样本及重复工作区。这里仅保存结论，不是可重新核验的原始证据包。

已有本地无模型验证曾观察到：公开 before hook 能将保存的 background 写入实际调用；后台创建后漏参续接仍后台并通过原发布校验；前台创建后漏参续接仍前台。环境为 OpenCode 1.19.3、SDK/plugin 1.19.0，本地脚本 SSE，无真实解题模型。

上述结果来自含扩展改动的旧原型，不能代替未来最小补丁验收。旧模式锁定、报错永久禁用、promotion 和停止改造不在当前范围；旧失败不因此改为通过，生命周期问题也不因此视为解决。

当前依据为[最小 design](../../../../superpowers/specs/2026-10-25-design-v1-sync-resume-provenance.md)。旧参考驱动在主工作区忽略目录 runs/task-parameter-reference/native/；本次实际驱动与单次验收见下文。两个废弃隔离工作区已归档并移除实际目录；应用的恢复快照不是活动工作区。

## 2026-10-25 最小实现验收

隔离区 `task-parameter-minimal/pentest-agent`，Git 祖先 `ee78e017a3fdbb8418329ca1843968b2fc2596f5` 加带入 dirty 基线。最小代码已完成并按逐文件 hash 合回主工作区，已有 dirty 工作保留。公开 before 保存／补参的最终代码执行一次 success：后台创建完成 → 同 child 漏参续接（只调用一次，无拒绝后补 true）→ 原生 metadata.background=true → 本轮 file/job/http 发布通过原校验，Engineer 读回核对 bytes。

最小可核对摘录：[minimal-native-excerpt.json](minimal-native-excerpt.json)。单次原始样本已转存主工作区忽略目录 `runs/task-parameter-minimal/native/attempt-success.qbWnwm/`，不向文档目录复制完整请求响应。OpenCode 1.19.3，SDK/plugin 1.19.0，隔离 HOME/XDG，外网连接自检 EPERM，仅本地 scripted provider。49 文件／486 测试、typecheck、build 通过。只验证装配与产物接收，不证明真实解题、solved、模式切换后的完整发布或错误／停止生命周期。

主区同步了核心及 C／D／G、结果完整性 design 的完成状态；一次性 plan 已删除。本片没有模式锁定、永久撤销或扩大停止改造。工作树在收口后归档移除，未 commit／push。

主工作区整合后：typecheck、build、49 文件／486 项测试全部通过，git diff --check 通过；源码与原生摘录 hash 一致，未重复原生运行。范围外已有文件按合入前 hash 核对未变。
