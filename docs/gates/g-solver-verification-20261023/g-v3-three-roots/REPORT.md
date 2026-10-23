# G-V3 三根映射无模型验证

2026-10-23（Asia/Tokyo）。独立 managed worktree：`/Users/caihaoming/.codex/worktrees/g-v3-three-roots/pentest-agent`。基准 HEAD d83a0c3024271dbf212db319e900fcf527e68b0f。仅 G-V3 原型，无产品接线、无 OpenCode/provider 启动、无真实模型调用；provider usage 不适用。

## 来源与失败

主工作区当前文档按原相对路径复制，hash 见 sources.json。旧原型只读复制自 `.claude/worktrees/e-intake-prep-07ba1c`，其 HEAD 9fb3e01d1c72a25faf597e9546b0c9c032617af1；两个原型为 untracked，原件按原内容保留 baseline/。本轮在该旧工作区 docs/gates 未找到 G-V3 完整报告；历史 9/9 与变异结论只保留设计原文，不补造旧日志。

red.log：真实 prepareRun 材料首次正向读取被共同根接口拒绝。red-root-list.log：改映射后根目录本身 list 被误拒；修正 walk 空余路径的目录信息，未改变 fixture 绕过失败。green.log 为最终定向结果。

## 判据映射

- 真实 E prepareRun：workspace/same/materials；同题 work/one、work/two，共享 published。两个宿主根对象分别调用四种工具；不向模型增加身份参数。
- 两者读取同份材料、宿主发布文件成功，各自写入并读回 nested/own.txt；文件内容分别断言。
- list 虚拟顶层仅三根，work 根及子目录可列；search 默认遍历三根及指定 materials 根成功，只有本会话工作文件，无宿主绝对路径、无另一会话内容。显式另一会话绝对路径、共同父目录、外部路径及父目录跳转在 list/read/search/write 全部拒绝。
- 指向另一会话 work 的 symlink：显式 list/read/search/write 拒绝，默认 search 跳过；旧九项保留根内/外、中段/末段 symlink 回归。未进行并发恶意替换的 TOCTOU 验证，工具检查不构成 OS 隔离。
- materials/published 写入拒绝，两文件 SHA-256 前后一致；两会话 work 内容最终不变。E 文件 mode 0444 由真实 prepareRun 产生。
- 旧九项布局不变，仅调用参数改成三根对象：非法路径、symlink、只读拒写与 hash、fixture 0444、UTF-8 分页及 cursor、字面搜索、501→500 截断、超过 1MiB 拒写且无残留。

## 结果与限制

定向 10/10；typecheck/build 与全套测试结果见对应日志。运行版本见 versions.txt，当前共享本地依赖实际 Vitest 2.1.9（package.json 声明 ^2.1.8）。未重新安装依赖。

128MiB 配额、OS 文件/进程隔离、G-V1 绑定自动建目录、正式插件/launcher 接线、E/G 共用读实现均未验证或实现。本轮只证明确定性工具三根映射；不证明模型能力或 solved。无 commit/push/合并，未修改主或旧工作区。
