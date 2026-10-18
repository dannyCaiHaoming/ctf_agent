import { defineSkill } from './index.js';
export const skill = defineSkill({
  domain: 'misc', scope: 'benign_synthetic_fixtures',
  applicabilityClues: ['Supplied local synthetic files contain canonical base64 or hexadecimal text; their original bytes are available.'],
  minimalExperiment: ['Ingest once with hash, magic, byte size, structure and source metadata; choose one encoding from that evidence.', 'Stage a bounded base64 or hex decode. Publish its bytes and parent/recipe/parameter provenance only when saved or actually consumed.'],
  failureBranches: ['Reject malformed encodings, repeated content and repeated expansion; stop at depth, product or expanded-byte limits.', 'Opaque container or media magic is recorded but unsupported parsing returns a capability gap outside this narrow method.'],
  verification: ['Check canonical roundtrip and read immutable output/provenance before candidate registration.', 'Test the derived string against a separate local equality oracle; an attractive string alone is not acceptance.']
});
