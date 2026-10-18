# Benign modular arithmetic puzzle

Compute `base ** exponent mod modulus` from `input.json`, using canonical unsigned decimals, and format the result as `puzzle{decimal_result}`. The numbers are small synthetic integers, not cryptographic keys. Python must pass real gcd/inverse/modular-power self-checks, and the host independently recomputes the result.

The test-controller equality oracle in `oracle.ts` is separate from the input and from the computation. This fixture tests no cryptanalytic technique, lattice algorithm, remote oracle or live model.
