import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { ArtifactStore } from '@ctf/artifacts';
import { ToolRuntime } from '@ctf/runtime';
import { byteIntegerRecord, integerToBytes, persistByteIntegerRecord, PythonArithmetic } from '../../packages/supervisor/src/domain-crypto.js';
import { DomainCandidateRegistry } from '../../packages/supervisor/src/domain-candidates.js';
import { puzzleOracle } from '../../fixtures/challenges/crypto/oracle.js';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
async function setup(python = 'python3') {
  const root = await mkdtemp(join(tmpdir(), 'domain-crypto-')); roots.push(root);
  const store = new ArtifactStore(join(root, 'artifacts'));
  const runtime = new ToolRuntime(store, join(root, 'workspace'), 'domain-run', 'crypto-puzzle');
  return { store, math: new PythonArithmetic(runtime, store, 'solver', python) };
}

describe('exact byte records and verified bounded Python integer arithmetic', () => {
  it('preserves zero bytes, endian, domain, width, padding and input source in exact roundtrips', async () => {
    const { store } = await setup();
    const source = await store.publish(Buffer.from('00000102', 'hex'));
    const big = byteIntegerRecord(Buffer.from('00000102', 'hex'), { endian: 'big', domain: 'unsigned_integer', padding: 'none', sourceRef: source });
    expect(big).toMatchObject({ hex: '00000102', integer: '258', byteLength: 4, leadingZeroBytes: 2, bitLength: 9, widthBits: 32, endian: 'big', padding: 'none', sourceRef: source });
    expect(integerToBytes(big.integer, big.byteLength, big.endian)).toEqual(Buffer.from('00000102', 'hex'));
    const littleSource = await store.publish(Buffer.from('02010000', 'hex'));
    const little = byteIntegerRecord(Buffer.from('02010000', 'hex'), { endian: 'little', domain: 'unsigned_integer', padding: 'none', sourceRef: littleSource });
    expect(little.integer).toBe('258');
    expect(little.trailingZeroBytes).toBe(2);
    expect(integerToBytes(little.integer, little.byteLength, little.endian)).toEqual(Buffer.from('02010000', 'hex'));
    expect(() => integerToBytes('256', 1, 'big')).toThrow('fit');
    expect(() => integerToBytes('-1', 2, 'big')).toThrow('unsigned');
    expect(() => integerToBytes('01', 2, 'big')).toThrow('canonical');
    expect(() => integerToBytes('1', 2, 'native' as 'big')).toThrow('endian');
    expect(() => byteIntegerRecord(Buffer.alloc(0), { endian: 'big', domain: 'unsigned_integer', padding: 'none', sourceRef: source })).toThrow('empty');
    expect(() => byteIntegerRecord(Buffer.from('0100', 'hex'), { endian: 'big', domain: 'unsigned_integer', padding: 'none', sourceRef: source })).toThrow('source identity');
  });

  it('persists immutable conversion provenance tied to verified source bytes', async () => {
    const { store } = await setup();
    const bytes = Buffer.from('00000102', 'hex');
    const sourceRef = await store.publish(bytes);
    const persisted = await persistByteIntegerRecord(store, bytes, { endian: 'big', domain: 'unsigned_integer', padding: 'left_zero_bytes_preserved', sourceRef });
    const artifact = JSON.parse((await store.read(persisted.recordRef)).toString());
    expect(artifact).toMatchObject({ schema: 'byte-integer-record/v1', source: sourceRef,
      conversion: { representation: 'unsigned_integer', endian: 'big', domain: 'unsigned_integer', padding: 'left_zero_bytes_preserved' },
      record: { hex: '00000102', integer: '258', byteLength: 4, leadingZeroBytes: 2, widthBits: 32 } });
    await store.verify(persisted.record.sourceRef);
    await expect(persistByteIntegerRecord(store, Buffer.from('0102', 'hex'), { endian: 'big', domain: 'unsigned_integer', padding: 'none', sourceRef })).rejects.toThrow('source identity');
  });

  it('self-checks actual Python operations then solves a synthetic modular arithmetic puzzle with a separate oracle', async () => {
    const { math, store } = await setup();
    const capability = await math.probe();
    expect(capability.status).toBe('available');
    if (capability.status !== 'available') throw new Error('Python unavailable');
    expect(capability.operations).toEqual(['gcd', 'mod_inverse', 'mod_pow']);
    expect((await store.read(capability.evidenceRef)).toString()).toContain('self_check');
    const input = JSON.parse(await readFile(resolve('fixtures/challenges/crypto/input.json'), 'utf8'));
    const result = await math.compute({ operation: 'mod_pow', a: input.base, exponent: input.exponent, modulus: input.modulus, timeoutMs: 2000 });
    expect(result.status).toBe('computed');
    if (result.status !== 'computed') throw new Error('arithmetic failed');
    expect(result.value).toBe('10');
    expect(result.verified).toBe(true);
    expect(result.jobId).toMatch(/^job_/);
    const raw = JSON.parse((await store.read(result.evidenceRef)).toString());
    expect(raw.value).toBe('10');
    const registration = await new DomainCandidateRegistry(store).register({ value: `puzzle{${result.value}}`, format: /^puzzle\{[0-9]+\}$/, minBytes: 8, maxBytes: 32, evidenceRefs: [result.evidenceRef, capability.evidenceRef] });
    expect(await puzzleOracle.submit(registration.value)).toMatchObject({ authoritative: true, status: 'accepted' });
    expect((await math.compute({ operation: 'gcd', a: '54', b: '24' })).status).toBe('computed');
    const inverse = await math.compute({ operation: 'mod_inverse', a: '3', modulus: '11' });
    expect(inverse).toMatchObject({ status: 'computed', value: '4', verified: true });
  });

  it('checks necessary conditions before spawning and returns specific capability gaps without denying available arithmetic', async () => {
    const { math } = await setup();
    await expect(math.compute({ operation: 'mod_inverse', a: '6', modulus: '9' })).rejects.toThrow('coprime');
    await expect(math.compute({ operation: 'mod_pow', a: '5', exponent: '-1', modulus: '23' })).rejects.toThrow('unsigned');
    await expect(math.compute({ operation: 'mod_pow', a: '5', exponent: '3', modulus: '0' })).rejects.toThrow('modulus');
    await expect(math.compute({ operation: 'gcd', a: '1'.repeat(1300), b: '2' })).rejects.toThrow('input range');
    await expect(math.compute({ operation: 'gcd', a: '2', b: '3', timeoutMs: 999999 })).rejects.toThrow('timeout');
    const gap = await math.requireCapability('sage_symbolic_algebra');
    expect(gap).toMatchObject({ status: 'needs_capability', missing: 'sage_symbolic_algebra', availableAlternatives: ['python_integer_arithmetic'] });
    if (gap.status !== 'needs_capability') throw new Error('expected specific capability gap');
    expect(gap.reason).toContain('not probed');
    expect((await math.compute({ operation: 'mod_pow', a: '5', exponent: '3', modulus: '23' })).status).toBe('computed');
    const matrix = await math.probeBackendMatrix();
    expect(matrix.status).toBe('probed');
    expect(Object.keys(matrix.backends).sort()).toEqual(['gmpy2', 'sympy', 'z3']);
    expect((await math.probeBackendMatrix()).jobId).toBe(matrix.jobId); // repeated reads use the same retained capability probe
    for (const name of ['sympy', 'gmpy2', 'z3'] as const) {
      const capability = await math.requireCapability(name);
      expect(capability).toHaveProperty('evidenceRef');
      if (capability.status === 'available') expect(capability.operations.length).toBeGreaterThan(0);
      else expect(capability.missing).toBe(name);
    }
    const missing = await setup('/nonexistent/fixture-python');
    expect(await missing.math.probe()).toMatchObject({ status: 'needs_capability', missing: 'python_integer_arithmetic' });
  });
});
