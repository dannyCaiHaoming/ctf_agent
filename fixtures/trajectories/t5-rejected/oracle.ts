import { LocalFlagOracle } from '../../../packages/local-oracle/src/index.js';

/** Controller-only authority; this file is never given to candidate verification. */
export const t5Oracle = new LocalFlagOracle('puzzle{slot_a}');
