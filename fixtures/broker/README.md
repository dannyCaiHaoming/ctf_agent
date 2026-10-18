# Hard-limit broker fixture boundary (M1 Task 6)

M1 host-dev exposes only `metering_unavailable` hard-limit capabilities. The
runtime validates the complete §8.4 metadata and rejects any job/channel request
carrying `hardLimit` before creating a process or opening a socket. Ordinary PTY
and TCP streams have no enforceable query accounting and cannot opt into a hard
limit by setting a status field.

The interactive contract tests create fresh loopback echo endpoints. They prove
binary transport, ownership, cursor eviction and cleanup; they do **not** prove
raw-endpoint isolation. No proxy/broker fixture is labeled isolated here. Hiding
an endpoint address from the model would not prevent an arbitrary Tool job from
using a raw socket.

Deferred to M2/M3, as allowed by the Task 6 plan:

- A network topology/egress policy in which ordinary job/browser raw access fails
  while the managed broker can reach the endpoint, with negative bypass tests.
- Authoritative framing/counting and pre-send durable unit reservation.
- Retry/redirect/batch disablement or exact platform-semantic counting.
- Unknown-result retained reservations, minimum-scope quarantine, reconciliation,
  and tests proving no reconnect or resend after an ambiguous dispatch.

Until all those conditions are verified together, real hard-limit and one-shot
oracle transports remain unavailable. This does not block unrelated ordinary
interactive tools or hypotheses. Listener/callback publishing remains M5.
