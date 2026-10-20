import { describe, expect, it } from 'vitest';
import { assertT2AttemptAllowed } from '../../docs/gates/m1b-t2-runner.js';

describe('trajectory 2 frozen batch admission', () => {
  it('limits this authorization to three reserved runs, including failures', () => {
    expect(() => assertT2AttemptAllowed(2, 2)).not.toThrow();
    expect(() => assertT2AttemptAllowed(3, 3)).toThrow(/authorized/);
  });
  it('preserves the twelve-attempt trajectory total across batch changes', () => {
    expect(() => assertT2AttemptAllowed(0, 11)).not.toThrow();
    expect(() => assertT2AttemptAllowed(0, 12)).toThrow(/STOP_RULE/);
    expect(() => assertT2AttemptAllowed(0, 13)).toThrow(/STOP_RULE/);
    expect(() => assertT2AttemptAllowed(2, 1)).toThrow(/ledger/);
  });
});
