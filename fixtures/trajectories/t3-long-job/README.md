# T3 long-job continuation fixture

The deterministic fixture starts one bounded local process that outlives the
initial Worker turn. The host persists the `job_id`, task/experiment binding,
cursor, continuation reference and deadline before releasing that turn. The
managed runtime terminal event is atomically written to State and its outbox;
the resumed Worker claims the same continuation once and reads the remaining
output. Waiting is event-driven and makes no model calls.

The fixture exercises host continuation mechanics only. It is not a model
trajectory or part of the six-trajectory statistical gate.
