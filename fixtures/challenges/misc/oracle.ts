import { LocalFlagOracle } from '../../local-oracle/src/index.js';
// Test-controller-only ground truth; do not expose this module as a puzzle input.
export const puzzleOracle = new LocalFlagOracle('puzzle{encoded_text}');
