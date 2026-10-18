import { LocalFlagOracle } from '../../local-oracle/src/index.js';
// Test-controller-only equality oracle for a synthetic arithmetic puzzle.
export const puzzleOracle = new LocalFlagOracle('puzzle{10}');
