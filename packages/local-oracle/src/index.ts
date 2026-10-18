import type { LocalOracleAdapter, OracleResult } from '@ctf/platform';

export class LocalFlagOracle implements LocalOracleAdapter {
  readonly name = 'local_oracle' as const;
  private readonly flags: readonly string[];
  private readonly accepted = new Set<number>();
  private readonly submitted = new Set<string>();
  constructor(correctFlag: string | readonly string[]) {
    this.flags = Array.isArray(correctFlag) ? [...correctFlag] : [correctFlag as string];
    if (!this.flags.length || this.flags.some(flag => !flag) || new Set(this.flags).size !== this.flags.length) throw new Error('oracle flags must be nonempty and unique');
  }
  async submit(candidate: string): Promise<OracleResult> {
    if (this.submitted.has(candidate)) return this.result('duplicate');
    this.submitted.add(candidate);
    const matchedSlot = this.flags.findIndex((flag, index) => flag === candidate && !this.accepted.has(index));
    if (matchedSlot < 0) return this.result('rejected');
    this.accepted.add(matchedSlot);
    return this.result('accepted', matchedSlot);
  }
  private result(status: OracleResult['status'], matchedSlot?: number): OracleResult {
    const correctFlagCount = this.accepted.size; const totalFlagCount = this.flags.length;
    return { authoritative: true, status, requiredSlots: totalFlagCount, correctFlagCount, totalFlagCount,
      ...(matchedSlot === undefined ? {} : { matchedSlot }), completed: correctFlagCount === totalFlagCount };
  }
}
