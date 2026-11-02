import {describe, expect, it} from 'vitest';
import {investigationView} from '../../apps/launcher/src/investigation-context.js';

describe('Recon investigation context', () => {
  it('walks the complete history through stable cursor pages', () => {
    const rows = Array.from({length: 45}, (_, index) => ({
      id: index + 1,
      sequence: index + 1,
      kind: 'tool',
      tool: 'workspace.read',
      status: 'completed',
      created_at: index + 1,
      updated_at: index + 1
    }));

    const seen: number[] = [];
    const pages: any[] = [];
    let cursor: string | undefined;
    do {
      const page = investigationView(rows, {cursor, limit: 7});
      pages.push(page);
      expect(page.coverage.returned).toBeLessThanOrEqual(7);
      seen.push(...page.index.map((record: any) => record.id));
      cursor = page.coverage.next_cursor ?? undefined;
    } while (cursor);

    const first = pages[0];
    const last = pages.at(-1);
    expect(first.coverage).toMatchObject({total: 45, remaining: 38, complete: false});
    expect(seen).toEqual(rows.map(row => row.id));
    expect(new Set(seen).size).toBe(45);
    expect(last.coverage).toMatchObject({remaining: 0, complete: true, next_cursor: null});
  });
});
