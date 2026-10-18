import { randomUUID } from 'node:crypto';
import type { ArtifactReference, ArtifactStore } from '@ctf/artifacts';

export interface DomainCandidate {
  id: string;
  value: string;
  status: 'candidate_only';
  valueRef: ArtifactReference;
  evidenceRefs: ArtifactReference[];
}

/** Local registration only. T9 verification and Platform Service submission remain separate. */
export class DomainCandidateRegistry {
  constructor(private readonly artifacts: ArtifactStore) {}

  async register(input: { value: string; format: RegExp; minBytes: number; maxBytes: number; evidenceRefs: readonly ArtifactReference[] }): Promise<DomainCandidate> {
    if (!Number.isInteger(input.minBytes) || !Number.isInteger(input.maxBytes) || input.minBytes < 1 || input.maxBytes < input.minBytes || input.maxBytes > 4096) throw new Error('invalid candidate length bounds');
    const size = Buffer.byteLength(input.value, 'utf8');
    if (size < input.minBytes || size > input.maxBytes) throw new Error('candidate length outside bounds');
    if (!input.format.source.startsWith('^') || !input.format.source.endsWith('$') || /[gym]/.test(input.format.flags)) throw new Error('candidate format must be anchored without global, sticky or multiline flags');
    const match = input.format.exec(input.value);
    if (!match || match[0] !== input.value) throw new Error('candidate format mismatch');
    if (!input.evidenceRefs.length) throw new Error('candidate requires evidence references');
    for (const ref of input.evidenceRefs) await this.artifacts.verify(ref);
    return {
      id: `candidate_${randomUUID()}`, value: input.value, status: 'candidate_only',
      valueRef: await this.artifacts.publish(Buffer.from(input.value, 'utf8')),
      evidenceRefs: input.evidenceRefs.map(ref => ({ ...ref }))
    };
  }
}
