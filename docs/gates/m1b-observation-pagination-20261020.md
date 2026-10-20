# M1b Observation 分页确定性接线记录（2026-10-20）

## 范围

- 按刷新后的 M1b §0.2，只处理真实侦察 run 暴露的通用 Web `http.request` 大文本响应；没有修改⑤⑥③④的 fixture、runner 或验收门槛。
- DVGA 首次 run 在 6 次 provider 请求后消耗 97,111 input / 4,542 output tokens（100,000 observable-token budget），此前所有 GraphQL HTTP response body 都完整进入模型上下文；canonical 证据见 [侦察记录](m1b-real-web-scout-20261020/scout-record.md)。

## 接线

- 完整 HTTP response body 仍由 Runtime 收取并存为 immutable artifact，不整段发送给 provider。
- 不超过 2 KiB 的文本响应保持 inline；更大的文本响应只返回状态、大小、content type、2 KiB preview、opaque run-bound `observation_ref` 与 `next_cursor`。
- `observation.read` 只接受本 run 生成的 ref、精确的下一 cursor 和最多 4 KiB 的页面请求。UTF-8 页保持字符边界；重复／回退 cursor 会被拒绝。
- 每个回取页形成 immutable artifact range，canonical tool event 同时绑定完整 source artifact、range 和摘要 artifact。provider 只收到 hash/size，不收到本机 artifact path。
- 非文本 binary response 分类为 `artifact_bulk`，仅在本机保留，不提供机械 base64 分页接口。
- 仅通用 Web 路径获得 `observation.read`。job/solver output 不在此切片修改，以保留既有完整原始输出送达与轨迹证据契约。

## 验证

- TDD：新集成断言在实现前失败，显示大 HTTP body 被完整放入 tool observation；接线后验证大文本预览、cursor 分页、cursor 回退拒绝、本机 artifact range、provider input 不含完整响应或 artifact 路径、binary bulk 留在本地。
- `tests/integration/cli-m1-http-solve.test.ts`：3/3 通过。
- `npm run gate:m0`：29 文件／167 测试通过。
- `npm run gate:m1`：3/3 通过。
- `npm test`：52 文件／300 测试通过。
- `npm run typecheck`、`npm run build`、`git diff --check` 通过。

## 未验证事项

- 本地 deterministic provider 只验证响应形状与数据边界；没有证明真实模型的 input-token 曲线会下降，也没有证明模型能推进到候选阶段。
- 按计划不自动再次访问 DVGA 或调用外部模型。0.2 的真实复跑与结果记录保持未勾选，等待用户逐次提供 token 预算授权。
