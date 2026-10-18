# Deterministic local compaction trajectory

`inspect.cjs` produces an immutable early output with a literal-parser observation and a decoding key, followed by long diagnostics. `continue.cjs` can decode `input.json` only by reopening the saved byte range from the early output. The first command increments an inspection counter so replay of the rejected route is observable. No provider or model is used. These are supplied challenge materials, not a native-provider/live acceptance test.

`checkpoint-process.ts` is a gated deterministic test driver: it accepts only `--deterministic-local-fixture <new-root>`, uses actual local ToolRuntime jobs, saves all evidence and the strict snapshot into SQLite, writes a host-pinned local authorization, prints readiness, and waits to be killed by the test. The second process enters the actual `ctf-agent resume` CLI.
