# 已退役实现：只供历史查阅

本目录保存清理前 `baed7fa17f21de83eefb27a9d85f956402dec7ad` 的 19 份文件，原字节不变，逐文件 SHA-256 见 `manifest.json`。不作为实现范本，不扩充，不从产品或活动测试导入。

- `tests/legacy/`：旧自建 SolverLoop、JSON 动作协议及直连 provider 驱动。
- `tests/integration/solver-loop-*`、`tests/contract/provider-solver-driver.test.ts`：旧框架专属测试与装配；保存失败场景供 M1b 迁移参考，不作为当前能力证明。
- `tests/contract/metrics.test.ts`、`tests/integration/verified-multiflag-candidate.test.ts`：迁移前原件。活动目录已有解耦后的组件测试。
- `.opencode/agents/`：早期 Web 渗透测试流程，依赖当前仓库不存在的 harness/tools；从根目录自动加载位置退出。浏览器探索与认证交接思路仅作未来参考。

归档不在 TypeScript `include` 或 Vitest `include` 内，不能在本目录直接运行；为保留原字节，没有改写相对 import。历史重放应在独立 checkout 使用上面的完整提交及当时工具版本。更早的 M0 自建循环、适配器可从 `3fa7d3e:packages/supervisor/src/index.ts` 恢复，不再复制一套到仓库。

当前产品唯一求解路径：`solve → OpenCode → 受管 plugin/Bridge → Runtime → 独立验证 → oracle`。M1b 的真实 OpenCode 改路、长作业、compaction、多 flag 接线仍未验收；不能把这里的旧测试算作已完成。
