import { LocalFlagOracle } from '../../../packages/local-oracle/src/index.js';

/** Controller-only two-slot equality oracle. */
export function createT6Oracle(): LocalFlagOracle { return new LocalFlagOracle(['puzzle{first}', 'puzzle{second}']); }
