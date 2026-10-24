# Root §7.1 实作验收

主区仅接入 launch.ts、progress-ledger.ts、root-result.ts 与 launch-evidence.test.ts 四个文件的本次增量；精确差异见 final-implementation.patch（相对开工dirty快照，不是HEAD）。当前设计与限制见详细design §8。

main-verification.json 与 main-test.log 记录主区 typecheck/build/test 通过，49文件430项。review-final.md 关闭review.md的唯一P2测试缺口，mutation日志显示错误实现的读取次数为5而正确要求为7，生产源码恢复hash见review-fix-restore.json。原生四例native-minimal-evidence.json来自固定1.19.3、本地替身、最终生产源码；测试修正未改变该源码，未重复模型链。

完整临时运行记录与历次失败日志在 `/var/folders/tn/x1hbkfy17sx0w1lb8kjzzr340000gn/T/ctf-root-implementation-nckgo_7w`。本目录只保留最小验收证据；implementation-report.md提到但未复制的日志在该审计目录。probe源码保留当次绝对输出和导入路径，重放必须改为新的隔离位置并先检查OS网络隔离，不能覆写旧run。

没有真实模型、目标或solved验收；没有commit/push。正常报告complete不证明内容正确。冻结快照不是原子最终状态，后续导出变化通过exportedSourceMatches显示。既有progress先写、后续证据写失败再更新最终run状态的时序限制仍保留，没有扩大成本轮通用证据系统重构。
