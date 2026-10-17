# T0b — Billing Mode and Automation Permission

**Date:** 2026-10-17  
**Provider:** Volcano Ark / 火山方舟  
**Current credential:** user-supplied Coding Plan credential stored only in root `.env` as `ARK_API_KEY`.  
**Conclusion:** For this project, the user explicitly authorized the current Coding Plan credential and configured Anthropic-compatible coding endpoint for T0a and the current usage path. Official provider documentation still records a broader restriction for unsupported non-AI-tool/API usage; that operational risk is noted, but the user-owned decision unblocks T0a.

## Official evidence

1. **Billing mode is subscription, not pay-as-you-go.**  
   Source: [方舟 Coding Plan · 套餐概览](https://ark.volcengine.com/region:cn-beijing/docs/ark/coding-plan-personal-plan-overview), retrieved 2026-10-17. The page describes Lite / Pro subscription plans and refreshes quota by 5-hour / weekly / monthly windows.
2. **Supported endpoint must be the coding endpoint.**  
   The same page says:
   > 务必使用 Coding Plan 支持的模型及 Base URL：`https://ark.cn-beijing.volces.com/api/coding/v3`（兼容 OpenAI 协议）或 `https://ark.cn-beijing.volces.com/api/coding`（兼容 Anthropic 接口协议）。
3. **Coding Plan quota is only for supported AI coding tools and cannot be used for API calls.**  
   The same page says:
   > 套餐额度仅在 AI 编程工具中生效，不可用于 API 调用。在非 AI 编程工具中使用方舟 Coding Plan 权益对应的 Base URL 和 API Key 有可能被识别为滥用/违规，会导致订阅停用或账号封禁。
4. **Pay-as-you-go is a separate mode.**  
   Source: [模型服务计费说明](https://ark.volcengine.com/region:cn-beijing/docs/ark/model-service-pricing), retrieved 2026-10-17. It describes **按 token 后付费** as token-based post-pay billing: “根据模型推理时消耗的 token 数量进行后付费” and “不调用不计费”.

## Consequence for T0a

On 2026-10-17 the user explicitly stated that Coding Plan can satisfy the current project use and directed the project to use the configured Anthropic-compatible coding endpoint. Accordingly, T0a runs with `ARK_API_KEY` and `https://ark.cn-beijing.volces.com/api/coding`. The provider documentation warning is preserved as an operational/compliance observation, not as a current blocker.

The T0a matrix runs 25 independent calls from `docs/gates/t0a-probes/run.mjs`. The existing real-model smoke run is still not reused as T0a evidence; T0a must produce its own five-run-per-probe artifacts.

## Configuration separation

`config/release-profile.volcano-anthropic.json` is the active project profile using the user-authorized Coding Plan endpoint. A separate pay-as-you-go example remains available at `config/release-profile.volcano-payg.example.json`; it is not required for the current usage but documents a future migration path if billing mode changes.

## Token sampling status

T0a completed on 2026-10-17 with 25 independent live calls. The observed token sample is **43,405 tokens total** (`input_tokens + output_tokens`) over all probe rounds.

| Probe | Runs | Total tokens |
| --- | ---: | ---: |
| P1 | 5 | 12,154 |
| P2 | 5 | 995 |
| P3 | 5 | 2,490 |
| P4 | 5 | 26,448 |
| P5 | 5 | 1,318 |

Full evidence is in `docs/gates/t0a-model-probes.md` and `docs/gates/t0a-probe-summary.json`. No budget cap is set, per plan; revisit after M1 real usage.
