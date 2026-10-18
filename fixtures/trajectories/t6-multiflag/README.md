# T6 multi-flag continuation fixture

The local oracle has two independent required slots. It returns authoritative
matched-slot, score-count and completion facts. The continuation persists the
first accepted slot immediately as `partial`, requests the next candidate, and
only reports `completed` after the second slot is accepted. Duplicate accepted
flags do not add score. This deterministic fixture does not claim a model
trajectory or the six-run statistical gate.
