import { LocalFlagOracle } from '../../local-oracle/src/index.js';
// Test-controller-only equality oracle, never supplied to the method/transport.
export const puzzleOracle = new LocalFlagOracle('puzzle{hello_reader}');
