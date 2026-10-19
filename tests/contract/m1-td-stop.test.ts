import { describe, expect, it } from 'vitest';
import { assertAttemptAllowed } from '../../docs/gates/m1-td-runner.js';

describe('T-D frozen batch admission', () => {
  it('counts every reserved attempt, including failures, and never exceeds twelve', () => {
    expect(() => assertAttemptAllowed(11, 12)).not.toThrow();
    expect(() => assertAttemptAllowed(12, 12)).toThrow(/STOP_RULE/);
    expect(() => assertAttemptAllowed(13, 12)).toThrow(/STOP_RULE/);
  });
  it('stops after the three runs authorized for this batch, even below twelve', () => {
    expect(() => assertAttemptAllowed(2, 3)).not.toThrow();
    expect(() => assertAttemptAllowed(3, 3)).toThrow(/authorized/);
  });
});
