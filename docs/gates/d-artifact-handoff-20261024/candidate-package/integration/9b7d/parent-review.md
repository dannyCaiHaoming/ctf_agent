# 主 session 独立验收

2026-10-24，Asia/Tokyo。已核对 9b7d 最终 28 项来源 hash、18 项增量范围、与 ae52 原型差异以及主区 3799 项基线，文档回写前主区基线全部未变。

直接产品逻辑差异是 C 对 package.read 同样限制为 Engineer；这符合既定权限，不增加 Verifier 接口。核对保留的 02-prototype-boundaries 失败，确认非 Engineer 读取在原型被允许，修正后 hook 与执行准入均拒绝。其余算法沿用原型，补充多页、包大小、32 文件上限、NFC/路径冲突及真实加载说明检查。

主 session 在子区独立运行四文件定向回归，41/41；运行 `npx tsx tests/manual/d-candidate-package.ts integration-parent-20261024-1152`，同一命令四场景 exit 0。作者批次 integration-20261024-114452 与主核对批次各自完整通过，未拼接。两个批次的 23 项 runtime 源码副本均与最终文件相符；原始 publication/candidate/manifest/E bytes、依赖、已加载角色正文、精确权限、package 工具说明和 RPC/停止时序独立核对在 parent-audit.json。

正常案同一 runtime 贯穿 E、Solver、Coordinator、Engineer、整包固定/读回/原生交回。四案提交数 1/1/0/1；每案两 job 一次整包请求、资源 settled；R2/R3 task id 来自真实原生返回值，使用 sibling 原生通知触发 Coordinator 停止，无 SDK child resume。回复丢失、提交前停止、提交后停止的不同事实均保留。

作者最终 typecheck/build exit 0、全套 362/362 的日志与来源已核对；主核对未改代码，不重复未变全套。保留 01 接口缺失失败、02 权限缺口失败和全部既有失败。没有修改主区产品或合并、commit/push、真实模型调用。

结论：第二接口在 9b7d 已实现并完成主核对，主区产品仍未接入。H1/H5/H7 限制未取消，实际包重放、语义依赖充分性、Verifier/可信提交、真实模型能力与 solved 未验证。工作区和 session 保留。
