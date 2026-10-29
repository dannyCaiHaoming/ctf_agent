# 图像观察能力：可行性研究与聚焦设计草稿

日期：2026-10-29（Asia/Tokyo）。状态：**DRAFT / pending-feasibility**。供 Opus 复核定稿，**不是已批准实现，也不是模型调用授权**。

依据：[核心设计 v1 §1.5、§1.6](2026-10-22-ctf-agent-design-v1.md)、[工具接入分析](../analysis/2026-10-29-ctf-tooling-analysis.md)、根目录 AGENTS.md／CLAUDE.md。本次只创建本文，未修改核心设计的反向链接；正式纳入哪一章节由定稿决定，不把草稿建立为平行权威。

## 0. 先回答可行性，不先承诺新增工具

| 门槛 | 本次判定 | 证据与尚缺内容 |
| --- | --- | --- |
| SOLVE 模型 `volcano-coding/deepseek-v4-1-flash-261017` 能否实际接收图片 | **UNKNOWN（项目端到端）** | 官方资料有该模型／系列的多模态正向证据，但没有本项目精确模型 ID、Coding Plan 端点、账户权限、有效配置和图片请求的联合实测。不能将同系列支持视觉、文本请求成功或配置声明当成可用 |
| OpenCode 是否存在公开图片传递路径 | **confirmed（静态类型＋1.19.3 上游源码）** | 插件结果支持 `attachments`，SDK 消息支持 `FilePartInput`，1.19.3 有附件转模型消息逻辑。**UNKNOWN（本项目实际连通）**：本地 SDK/plugin 是 1.19.0，当前 managed 工具只返回 JSON 文本，未做组合版本的模型图片探针 |

**推荐：第一步做 §4 的低成本可行性检查；r9 的当前候选选 C，A 保留为有条件的视觉方案，B 不默认启用，失败则 D。** C 更贴合现有 job 与薄控制层，但它能否解出这张手写图仍是 UNKNOWN。不存在“装 Pillow 就补齐模型视觉”的结论。

### 0.1 可行性探针结果（2026-10-29，adapter 包级 PASS，有保留）

已执行 §4 的合成图探针（经 codex、key 不入日志、无 flag 随机串）：**`@ai-sdk/openai-compatible` 适配器能把 `image/png` 作为 `image_url` 送达，`deepseek-flash` 能读图**——原文 `6520CD`→模型 `6529CD`（6/6 长度对、5/6 字符对、1 字误读；载荷确含 image_url 且解码与本地 PNG 一致；1 请求、无错、1.12s、265 token）。故 §0 两个技术门槛在**包级 confirmed**：模型能收图=是、适配器能带图=是。**保留：**(1) 探针用临时装的 `@ai-sdk/openai-compatible@3.0.80`、只测包级，未验 OpenCode 内嵌版本与完整 message-v2 file-part 端到端；(2) **精度风险**——连清晰串都错 1/6 字，而 r9 是低解析手写且 flag 需逐字精确（26 bytes），错一字即错 flag，故「能看图」≠「能精确读出手写 flag」，字形精度只能用真图/真跑验。

### 0.2 一个需用户拍板的政策门槛（技术可行之外）

deepseek 是**远端 API**。§1 的严格读法是「r9 图承载 flag，不得发到外部视觉服务」——若成立，A（远端 deepseek 看真图）对**真实含 flag 图**不可用，只能走本地视觉模型（B）或 C。但另一种读法：挑战的渲染图是**题目材料**，解题角色本就要处理它（如同现在把题面 HTML／源码文本发给远端 deepseek 解题一样），CLAUDE.md 禁的是**控制凭据与 oracle 私有答案**，非题目自身内容。**这两种读法得出相反结论，属用户的 scope/安全政策判断，本设计不自行拍板。** 探针只验证了无敏感合成图，从未发送真实 r9 图。

### 0.3 候选 A 最小接线已实现（2026-10-29，装配验证，端到端待真跑）

用户已确认政策：真实题目渲染图可发给远端 deepseek 解题模型（视为题目材料）。据此实现候选 A 的最小接线（分支 `codex/image-view`，commit `4704058c`，未合并）：新增 `workspace.view(path)` 工具——host 对 root-qualified 的 materials/work/published 图像（PNG/JPEG，按内容 magic 判定、≤1 MiB、O_NOFOLLOW+重 stat+有界读、published 走既有严格 ref/hash 校验），返回 ToolResult `attachments:[{type:file,mime,url:data:...;base64}]`，OpenCode 对 openai-compatible 适配器转成合成 user 消息交模型（探针已验该路径可读）；输出仅去敏 metadata、不含 bytes，图中文字为不可信数据，仅授四个 workspace 角色，不做 OCR/判定、不冒充 verified/solved。recon/domain-solver 角色已加一句事实性提示指向该工具。**验证到装配/契约层（tsc/build/test:deterministic 608/608）；模型是否真的看到并精确读出，尤其 r9 低解析手写 + 26-byte 逐字精确，仍 UNKNOWN，须授权的 seizurecipher 真跑认账（精度风险见 §0.1）。** C（确定性几何分析）仍可作并行/兜底。

还有一个独立于技术的范围门槛：用户明确禁止向任何外部视觉服务发送秘密／flag。r9 的图像本身承载 flag，故不能把原图、含答案裁剪、坐标或可逆编码发到外部视觉模型来规避禁令。A/B 的远端探针只允许无敏感合成材料；技术探针通过也不授权发送真实 r9 图。实际含 flag 图的模型观察需要满足边界的本地模型路径且另获授权，否则选 C/D。已有远端文本模型授权不能自动解释为图片外发豁免。

## 1. 来源、研究范围与模型门槛

本文**使用了 web**，检索日期同上。标记约定：**【本地 confirmed】**为本次静态读取；**【网络 confirmed】**仅确认所述上游文档／源码事实；**【用户事实】**为任务提供的前提；**【训练知识／推断，UNKNOWN】**为未在本题验证的机制分析。所有候选能否改善真实解题，除非另有实测，一律 **UNKNOWN**。未用社区讨论代替官方接口证据，没有搜索本题答案或 writeup。

### 1.1 DeepSeek 与自定义 provider

- **【网络 confirmed】** [DeepSeek 官方 Vision 指南](https://api-docs.deepseek.com/guides/vision/)当前说明 `deepseek-flash` 接受图像，支持 PNG 等格式及 inline data URL；原 `deepseek-v4-flash-vision-exp` 别名由新 Flash 承接。这只证明官方对应服务的契约，不证明所有 DeepSeek V4、火山套餐或自定义别名相同。
- **【网络 confirmed：官方搜索摘录，全文未取得】** [火山模型列表](https://docs.volcengine.com/docs/ark/model-list?lang=en)的搜索摘录将精确 ID `deepseek-v4-1-flash-261017` 标为“多模态理解”；[Coding Plan 模型上线公告](https://docs.volcengine.com/docs/ark/coding-plan-personal-model-release?lang=en)摘录将 `deepseek-v4.1-flash` 描述为原生视觉模型。直接打开两页只得到 JS 页面框架／语言不可用提示。因此有正向依据，但两种 ID 的套餐映射、图像参数限制及当前账户准入仍为 **UNKNOWN**。
- **【本地 confirmed】** [provider 示例](../../../config/opencode.volcano-coding.example.json)使用 `@ai-sdk/openai-compatible`，端点 `https://ark.cn-beijing.volces.com/api/coding/v3`，模型为题述 ID。示例只有名称和 context/output limit，没有显式 `attachment` 或 `modalities.input`。本地 SDK 类型允许这些字段；缺省后的实际能力值以及 r9 生效配置为 **UNKNOWN**。不能把修改声明当成给上游模型增加视觉能力。
- **【UNKNOWN】** 本次未读取账户凭据、查询套餐后台或发请求，也未核实第二个可用视觉模型。不能私自换成 DeepSeek 官方 API、普通 Ark `/api/v3`、Auto 别名或其他 provider；那会改变模型、路由、成本或授权范围。

### 1.2 OpenCode 图片传递路径

**【本地 confirmed】** 两个已安装包的 `package.json` 均为 **1.19.0**，不要写成已安装 1.19.3 SDK。以下是接口形状说明，不是实现代码：

| 入口 | 已确认的类型表面 | 本项目使用限制 |
| --- | --- | --- |
| 插件自定义工具结果 | `node_modules/@opencode-ai/plugin/dist/tool.d.ts`：`ToolResult` 可为含 `output`、`metadata`、`attachments?: ToolAttachment[]` 的对象；附件含 `type: "file"`、`mime`、`url`、可选 `filename` | 可候选为 host 从固定 PNG 构造 `image/png` 与 data URL；把 base64 放进 `output` 字符串不是该入口 |
| SDK 消息 | `node_modules/@opencode-ai/sdk/dist/v2/gen/types.gen.d.ts`：`SessionPromptData.body.parts` 包含 `FilePartInput`；它含 `type: "file"`、`mime`、`url`、可选 `filename` | 可经 `session.prompt` 发送文件 part；这里 `v2` 是包内路径，不据此声称运行 OpenCode 2。SDK `directory` 必须仍是 host 控制的 OpenCode 目录 |
| 模型／角色选择 | 同一 SDK 的 prompt 有 `agent`、`model`，`SubtaskPartInput` 有可选 model | 只确认字段存在；原生 task 能否正确携带图片并保留本项目绑定、计费为 **UNKNOWN**。prompt 文本里写 artifact ref 不会自动附图 |
| hook | `plugin/dist/index.d.ts` 中 `chat.message` 可访问 parts；`tool.execute.after` 的输出类型只有 title/output/metadata | 优先公开 ToolResult/SDK 路径，不假设 after hook 已有附件槽，不引入实验性消息改写循环 |

**【网络 confirmed，静态源码】** [1.19.3 registry.ts](https://raw.githubusercontent.com/anomalyco/opencode/v1.19.3/packages/opencode/src/tool/registry.ts)保留自定义工具返回的 attachments。[1.19.3 message-v2.ts](https://raw.githubusercontent.com/anomalyco/opencode/v1.19.3/packages/opencode/src/session/message-v2.ts)处理 file parts；不支持工具结果媒体的适配器会把媒体转成合成 user 消息。`@ai-sdk/openai-compatible` 不在其直接工具媒体支持列表中，因此须核验这条转移路径。源码也有 `stripMedia`／compacted 时去除媒体的分支。**UNKNOWN**：实际部署二进制、模型能力声明、provider 转换与压缩后重读是否共同正常；不能凭附件存入 session 就认定模型看到了像素。

[OpenCode SDK 文档](https://opencode.ai/docs/sdk/)与[自定义工具文档](https://opencode.ai/docs/custom-tools/)作为公开入口背景，网页为滚动版本；版本判断以上述本地包和带 tag 源码为准。没有发现“OpenCode 无图片 part 路径”的证据，反而已确认其存在；尚未确认的是本项目可用性。

## 2. r9 卡点与现有链路

**【用户事实＋本地记录 confirmed，非原始 run 复验】** 用户说明 r9 已重建 `work/fine.png`，ASCII 重绘和 chamfer 模板匹配仍停滞。[工作记录 r9 节](../analysis/2026-10-29-overnight-worklog.md)记载 `lol.js`／`coords.txt` 的 226 个坐标、canvas 文字、系统 Vision OCR 乱码，以及最后由 provider `AccountQuotaExceeded` 429 中止。本次未取得并逐项复核 r9 原始脚本、像素、完整调用记录和模板分数。因此“观察入口缺失”与“外部配额导致结束”要分开，不能把中止判为模型能力已被证伪。

**【本地 confirmed】** 当前链路为：

1. [workspace-tools.ts](../../../apps/launcher/src/workspace-tools.ts)可读写受管路径，`readWorkspace` 调用 [file-page.ts](../../../apps/launcher/src/file-page.ts)。二进制只返回 `binary`、signature 等信息，没有图像 part。
2. [job-tools.ts](../../../apps/launcher/src/job-tools.ts)能用 argv 运行本地脚本，固定 work cwd、环境白名单、无交互 stdin，保留 stdout/stderr 与终态。默认 60 秒、单 job 最长 600 秒，并受 operation deadline 限制；这不证明 Pillow/OpenCV/NumPy 已安装，也不证明 OS／网络隔离。
3. [artifact-tools.ts](../../../apps/launcher/src/artifact-tools.ts)固定 bytes、范围、来源与 hash；发布路径是 `published/<ref>.bin`，PNG 不必有 `.png` 后缀。`bytes()` 按 run/challenge/ref 绑定并重新检查 hash；`read()` 返回 base64 分页。文件快照上限 1 MiB，发布不证明原来源完整或文字正确。
4. [插件适配器](../../../apps/opencode-plugin/src/index.ts)的 managed execute 返回 `{title, output: JSON.stringify(result)}`，没有把 artifact 转成 attachments。**这是已确认的图像交付缺口，不是已确认的上游模型缺陷。**
5. [Recon](../../../product/opencode/agents/recon.md)和 [Domain Solver](../../../product/opencode/agents/domain-solver.md)已要求围绕问题与停止条件工作、发布固定 ref、原生 task 交回；不需为“能观察”另造解题调度器或修改可信成功判定。

### 2.1 ASCII、OCR、chamfer 为何可能停滞

以下是 **【训练知识／推断，UNKNOWN】**，不是已核实的 r9 根因：

| 方法 | 可解释停滞的机制 | 低成本证伪方式（后续授权内） |
| --- | --- | --- |
| ASCII 重绘 | 降采样、字符宽高比或输出截断破坏细线、间距与连通关系；全图反复换分辨率没有新增语义信息 | 对照原坐标与 canvas 变换，逐行／字框输出固定纵横比网格，核对未截断和端点保留；不把字符网格当完整视觉替代 |
| 系统 Vision OCR | 手写单笔画、低分辨率、标点和非自然语言字符串可能偏离识别器适用分布；放大已有像素不能补回丢失结构 | 先从坐标重新高分辨率绘制，检查线宽／背景／裁剪；只用无答案合成笔画诊断识别器，保留歧义，不用语言纠错补 flag |
| chamfer 模板匹配 | 印刷字体模板可能不匹配手写拓扑；切字错误、倾斜与尺度误差会主导距离，最近模板仍可能全错 | 读取原脚本、模板来源、分割结果和前两名分差；先查错切／合并，再用坐标中的笔画方向、端点、交叉及连通分量解释歧义 |

不把缺库当既成根因：既然已经重绘和匹配，至少部分计算链路存在。真正待区分的是 **渲染错误、结构丢失、模板不适用、字符本身歧义，还是缺乏视觉语义判断**。没有新证据时，不通过多装 OCR／更多字体模板无限试错。

## 3. 四个候选及结果去向（均未批准）

### A. 同模型视觉观察

**可行性：UNKNOWN；前提是 §0 两门槛都在目标组合上通过，且图像外发边界允许。** host 依据已发布 ref 解析固定 PNG，返回公开 ToolResult attachment；必要时比较 SDK file part 的公开入口。角色观察像素后交回文字、局部位置与不确定字符，不接管提交。

- **适配／scope：** 只补“固定 artifact → 模型媒体”的窄适配，复用原生会话与工具循环。优先让既有 domain-solver 消费；不建立 host OCR 推理循环、通用文件 URL 服务或全目录看图接口。真实 r9 flag 图在现有外发禁令下不能走远端 A。
- **成本：** 图片 token、上下文重传、PNG 解码内存和适配维护；具体费用 **UNKNOWN**，不能沿用纯文本估算。数量／像素限额须在探针中选定并记录。
- **结果去向：** host 固定输入 ref/hash 与调用绑定；观察结果回原生 task，必要时发布文本 artifact。语义仍是模型观察／候选，进入现有 Engineer 整理、Verifier 独立审阅及可信完成链，不自行产生 solved。

### B. 独立视觉 SUBTASK

**可行性：UNKNOWN；第二模型可用性、授权与原生任务图像交接均未确认。** 仅当 A 的模型能力不成立且确有符合边界的第二模型时考虑；不能因为开发助手能看图就认为产品已有视觉服务。

- **适配／scope：** 使用 OpenCode 原生 subagent/session 及固定角色模型配置，只传本题选定 published PNG 与必要观察问题。子任务默认只观察，不能联网、读取其他题材料、接触控制凭据、签署验证或提交。对承载 flag 的图，外部视觉服务仍禁用；本地视觉模型也须另行核实可用性，不能擅自安装／启用。
- **成本：** 第二模型的独立单价／图像计费、上下文、运行依赖和隔离成本更高；计入同 run 总账，不因子会话重置预算。CLAUDE.md 的开发模型分工不是产品第二模型授权。不得借 job 内 SDK/curl 直连 provider，也不新建模型路由框架。
- **结果去向：** 文本观察及歧义经原生任务回 Coordinator/Domain Solver，host 绑定输入引用、模型与用量；不把视觉子任务当独立 Verifier。图片如何跨原生 task 交接须用探针确认，失败转 C/D，不维护 OpenCode fork。

### C. 通过现有 job 加强确定性图像／几何分析（当前推荐）

**confirmed：现有 job 有脚本执行入口。UNKNOWN：依赖就绪、实际改善与 r9 解码成功。** 不新增模型视觉或专用 host 图像分析 API。

- **适配／scope：** 优先直接消费原始坐标与绘制代码，核对点序、断笔、坐标变换、缩放和线连接语义；不能把全部坐标无条件连成一条折线。Pillow 用于重绘／裁剪，NumPy 用于栅格统计；只有分割确需时考虑 OpenCV，不一次性全装。固定依赖在 run 外准备，Ubuntu ARM64 可用性仍需验证。
- **改善方向【训练知识／推断，UNKNOWN】：** 从向量源重新渲染清晰图，保留原始与派生物；按证据做行／字候选分割，输出端点、笔画方向、连通分量和有坐标的 ASCII／网格。既有 chamfer 失败先定位错切／模板偏差；有根据才调整归一化和匹配，不引入本题答案字典或穷举模板库。短脚本、短报告比整图大段 ASCII 更适配文本上下文。
- **成本：** 本地 CPU／内存、少量依赖及脚本调试，仍有 Solver 文本推理成本；不会凭空得到人的阅读能力。普通脚本留在受管 work，只有可复用缺口得到真实证据才考虑产品化。
- **结果去向／停止：** 发布源坐标、脚本、派生 PNG、分割／歧义说明，host 绑定版本与 hash；文本观察回现有角色。到问题无新进展或预算停止即交回，记录仍不能区分的字符，转 D 或重审 A/B。PNG 变清晰不是已恢复精确候选。

### D. 当前不支持，保留限制

**confirmed：可保持现有边界而不实施新能力；UNKNOWN：是否需新增产品状态字段，本文不建议新增。** 若无合法视觉路径、C 无新进展、模型／接口不可用或成本不可控，记录“已能渲染、尚不能可靠读出文字”及对应引用，沿用未解／不确定结果。成本是此类题能力空缺；不伪造候选、不将 OCR 乱码当结果，也不为单题引入外部 OCR 服务或另一个求解框架。

## 4. 第一步：便宜地判定可行性（尚未执行）

本步骤只回答“合法且受控的图片输入路径是否可用”，不先实现完整观察工具，不先重跑 r9。

1. **零模型成本检查。** 固定实际 OpenCode 二进制版本、SDK/plugin 版本与有效 provider/model；只提取去敏配置，核对模型 ID 映射、`attachment`／`modalities.input`、工具许可及 host directory。确认测试数据无秘密，账户额度与预算可用；不自行把示例的 128k 改成网页宣称的容量，不改变路由。
2. **另获明确 token 预算后做合成图探针。** 建议待批准的小批次上限为总计 8,000 可观察 token、最多 3 次单轮请求、5 分钟；这只是预算提案，不是现有授权，失败不自动重试。固定精确 SOLVE provider/model，使用无真实 flag 的随机短串＋几何关系 PNG，答案只在本地评价器；prompt、文件名及 metadata 不泄露答案。先 SDK file part，再公开插件附件路径；余下一次可做无图对照。只走 OpenCode，不直连模型。
3. **观察实际路径。** 记录 PNG hash/尺寸、session/call 绑定、存储的 part 类型、最终模型请求是否带媒体（探针阶段仅去敏观察）、准确读数与空间关系、错误类型、耗时和 provider usage。检查不是仅收到文本 placeholder；HTTP 200、模型说“能看见”、正确猜测短串均不能单独通过。usage 不可得记 `unavailable`；若不能可靠约束此次授权消耗则停止。
4. **按结果收口。** SDK 成功但工具失败：只定位公开附件接线，不能宣称 A 已可用于工具观察；两条都成功且有效读取：仅证明合成图连通，A 转为待范围许可／真实题验收。provider 明确拒图：记录该组合不支持，B 只有独立授权后才可探；429／超时／权限错误不当视觉能力否定，保持 UNKNOWN。无合规可行路径则 C/D。

## 5. 若继续设计：最小控制边界与验证

以下为 **设计约束，不代表已实现**。作用域只限授权题目／附件；不接公开搜索、线上 writeup、外部 OCR、秘密或答案上传服务。图片中的文本也是不可信题目数据，不能提升为指令或扩大权限。

host 接受已发布 ref，绑定当前 run/challenge、会话权限和来源；复用发布快照与 hash 检查，拒绝任意宿主路径、模型自填 data URL 和远程 URL。以真实内容识别 PNG，不依赖 `.bin` 后缀或模型声明 MIME。保留原图，派生裁剪／缩放另有来源关系；拒绝损坏、截断、超限、跨题或失效 ref，不静默修图或提升 `originalComplete`。

字节数沿用 1 MiB 发布边界；解码像素和内存上限须另外确定，压缩大小不能约束解压后资源。探针可先选单张、小尺寸图片，不用扩大通用 artifact 上限解决单题。身份、路径、hash、预算、错误与生命周期由 host 负责；算法和图像语义判断留在已有角色或脚本。若公共接口不能满足上述边界，结论应为不接入，而不是 fork／provider 旁路。

**后续验证需分别报告：**

- 无模型接线：对同一 ref 确认取回固定 bytes、附件实际 MIME/hash、跨题与篡改拒绝、超限／损坏处理、取消后无继续外发；不以 mock 证明视觉能力。
- 模型图片探针：§4 的真实 OpenCode/provider/model 组合读取无敏感合成图。记录媒体送达与读取正确性两层证据。
- 授权真实 run：事先固定题目初态、版本、工具依赖、模型、总 token／时间／尝试边界，并明确任何媒体的数据流是否满足外发禁令。C 在现有产品入口验证原始卡点；A/B 若无符合边界的路径就不启动真实图验证。不能在开发助手人工读图后把答案注入 Solver 再声称自主恢复。
- 内容与结果：保留对照的源坐标、原始 fine.png（如可取得）、新渲染／观察与歧义，区分可读图、正确文字、精确候选、独立审阅、裁判接受和 solved。当前核心设计 §1.3 允许 inconclusive 后按限制尝试裁判，不额外建立“视觉置信度达到阈值才能提交”的 gate。无可信 oracle 仍只能 candidate_only；已读工作记录不是该题 oracle 可用性的证明。
- 发布形态：Mac 系统 Vision 的存在不证明 Ubuntu ARM64 可用；被选择的本地依赖与隔离需在发布形态另验。单个 r9 成功也不代表通用视觉题能力成立。

## 6. 交给 Opus 的定稿点与本次完成边界

先依据探针确定精确模型和 OpenCode 路径，再决定是否值得把窄图像适配纳入薄控制层。A 需消除模型门槛与外发冲突；B 还需确认第二模型、原生子任务图像交接及成本授权；C 需从 r9 原始脚本证实停滞原因，而非增加工具数量。任何路径都不确定时，D 是有效结论。

本次只进行了本地只读检查、网页研究和本文创建；目标文件创建前不存在。遵守 no-git，未运行 git 或核验 dirty 状态；未覆盖现有文档。未安装依赖、编写产品代码、构建、测试、执行解题脚本、调用模型、上传题图或重跑题目。r9 原始脚本／PNG及生效配置未独立复验，真实运行二进制未执行核验。**本文仍是 DRAFT/pending-feasibility，不能据此宣称能力可构建、已实现或已通过真实验收。**
