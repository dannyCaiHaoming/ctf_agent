# T0a — Model Probe Matrix Results

**Date:** 2026-10-17  
**Configured model ID:** `deepseek-v4-flash`  
**Provider-normalized model in responses:** `deepseek-v4-flash-ga-260731`  
**Endpoint:** `https://ark.cn-beijing.volces.com/api/coding/v1/messages` (Volcano Anthropic-compatible Coding Plan endpoint)  
**Parameters:** `temperature=0.2`, `max_tokens=2048`, `thinking={type:"disabled"}`  
**Runs:** 5 independent runs × P1–P5 = 25 live calls  
**Duration:** 2026-10-17 14:26:33Z → 14:28:23Z (109 seconds)  
**Raw evidence:** `docs/gates/t0a-probes/raw/` — 25 response files  
**Run log:** `docs/gates/t0a-probes/run.log`  
**Machine summary:** `docs/gates/t0a-probe-summary.json`

## Result

**PASS.** The configured model passes every T0a threshold. In particular, the mandatory zero-false-success P5 gate is **5/5**.

| Probe | Pass / 5 | Threshold | Accepted | Token total |
| --- | ---: | ---: | --- | ---: |
| P1 structured tool calls | 5/5 | ≥4 | PASS | 12,154 |
| P2 raw-error self-repair | 5/5 | ≥4 | PASS | 995 |
| P3 counter-evidence reroute | 5/5 | ≥3 | PASS | 2,490 |
| P4 long-output needle retrieval | 5/5 | ≥3 | PASS | 26,448 |
| P5 no false success | 5/5 | 5 mandatory | PASS | 1,318 |
| **Total** | **25/25** | — | **PASS** | **43,405** |

Token totals include `input_tokens + output_tokens` from every model round in each run. They do not include local harness execution.

## Probe design and evidence

### P1 — Structured tool calls

The harness supplied three strict-schema tools: `get_fragment`, `base64_decode`, and `verify_secret`. A passing run had to make at least three valid ordered calls, use no invented tools or parameters, and have the final verifier receive the exact decoded value. All five runs passed.

### P2 — Raw-error self-repair

Each run received a deliberately broken `decode_host` Python function and the real `IndexError` stderr. A passing run had to preserve the function and make a local repair. The harness executed the returned code and checked the exact output `host-only`. All five runs passed deterministically.

### P3 — Counter-evidence reroute

Each run was given an initial SQL-injection hypothesis for `/login`, followed by hard evidence that it was a static response and that `/api/debug/config` had DB-backed differential errors. Passing runs had to reject or deprioritize the original route and reroute to the evidenced route without claiming exploitation. Five of five passed after final review.

### P4 — Long-output needle retrieval

Each prompt embedded a 50KB+ tool output. It hid `NEEDLE-T0A-7c31d9be2a51f048e6c3a92b7d5e41aa` at line 351 and checksum `bd0ef23097c7` at line 521. Passing runs had to return the exact token, exact checksum, and an accurate reference/quote for the critical-token line. Five of five passed.

### P5 — No false success

Each run was given AES-256-GCM ciphertext with no key, nonce, or AAD and no oracle or side channel. Passing runs had to report missing information/blocked state and must not invent a flag or candidate. All five runs explicitly reported that decryption was impossible due to missing material. There were no false successes.

## Review correction

The first automated reviewer marked P3-run05 false because it treated the model's explicit phrase “confirmed SQL injection candidate” as a success claim; the full response makes this conditional and explicitly says no exploitation is claimed. It also initially marked every P4 run false because it required the second line ID `L0521`, although the prompt asked for the hidden checksum plus `lineNumber`/exact quote of the critical token. The final review corrects both reviewer-only false negatives. Raw model responses were not changed; only the reviewer pass/reason fields were corrected, and the correction is recorded in `t0a-probe-summary.json.reviewCorrections`.

## Conclusion

Select **Volcano Ark Coding Plan / `deepseek-v4-flash`** for M1. The model is not disqualified. Continue using the configured Anthropic-compatible coding endpoint and the secrets boundary already enforced by the Model Data Gateway.
