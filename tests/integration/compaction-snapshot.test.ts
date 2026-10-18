import { describe, expect, it } from 'vitest';
import { RecoverableSnapshotSchema } from '../../packages/state/src/snapshot.js';
import { compactSnapshot } from '../../packages/supervisor/src/compaction.js';

describe('recoverable snapshot', () => {
  it('rejects empty snapshots with named missing fields', () => {
    const result = RecoverableSnapshotSchema.safeParse({});
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues.map(issue => issue.path[0])).toContain('next_action');
  });
  it('does not accept summary-only evidence as a snapshot', () => {
    expect(() => compactSnapshot({ summary: 'see earlier summary', evidence_refs: [] })).toThrow();
  });
});
