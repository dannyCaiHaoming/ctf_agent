import type { LocalOracleAdapter, OracleResult } from '@ctf/platform';

export class LocalFlagOracle implements LocalOracleAdapter {
  readonly name = 'local_oracle' as const;
  constructor(private readonly correctFlag: string) {}
  async submit(candidate: string): Promise<OracleResult> {
    return { authoritative: true, status: candidate === this.correctFlag ? 'accepted' : 'rejected', requiredSlots: 1 };
  }
}
