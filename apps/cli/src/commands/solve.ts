import { solveM1, type SolveM1Options } from './solveM1.js';

export type SolveOptions = SolveM1Options;

/** All product solve requests use OpenCode. Historical direct-provider adapters are not a fallback. */
export async function solve(options: SolveOptions): Promise<{ code: number; message: string }> {
  return solveM1(options);
}
