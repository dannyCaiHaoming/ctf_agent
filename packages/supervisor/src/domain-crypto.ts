import { createHash } from 'node:crypto';
import type { ArtifactReference, ArtifactStore } from '@ctf/artifacts';
import type { ToolRuntime } from '@ctf/runtime';

type Endian = 'big' | 'little';
export interface ByteIntegerRecord {
  hex: string; integer: string; byteLength: number; leadingZeroBytes: number; trailingZeroBytes: number;
  bitLength: number; widthBits: number; endian: Endian; domain: string; padding: string; sourceRef: ArtifactReference;
}
export interface PersistedByteIntegerRecord { record: ByteIntegerRecord; recordRef: ArtifactReference }
export function byteIntegerRecord(bytes: Uint8Array, input: { endian: Endian; domain: string; padding: string; sourceRef: ArtifactReference }): ByteIntegerRecord {
  if (!bytes.length) throw new Error('empty byte conversion is ambiguous');
  checkEndian(input.endian);
  if (!input.domain || !input.padding || !input.sourceRef.hash) throw new Error('explicit domain, padding and source required');
  const buffer = Buffer.from(bytes);
  if (input.sourceRef.size !== buffer.length || createHash('sha256').update(buffer).digest('hex') !== input.sourceRef.hash) throw new Error('byte record source identity mismatch');
  const ordered = input.endian === 'big' ? buffer : Buffer.from(buffer).reverse();
  const integer = BigInt(`0x${ordered.toString('hex')}`);
  let leadingZeroBytes = 0; let trailingZeroBytes = 0;
  while (leadingZeroBytes < buffer.length && buffer[leadingZeroBytes] === 0) leadingZeroBytes++;
  while (trailingZeroBytes < buffer.length && buffer[buffer.length - trailingZeroBytes - 1] === 0) trailingZeroBytes++;
  return Object.freeze({ hex: buffer.toString('hex'), integer: integer.toString(), byteLength: buffer.length, leadingZeroBytes, trailingZeroBytes,
    bitLength: integer === 0n ? 0 : integer.toString(2).length, widthBits: buffer.length * 8, ...input, sourceRef: Object.freeze({ ...input.sourceRef }) });
}

/** Persist an immutable conversion receipt whose source bytes are independently verified. */
export async function persistByteIntegerRecord(artifacts: ArtifactStore, bytes: Uint8Array,
  input: { endian: Endian; domain: string; padding: string; sourceRef: ArtifactReference }): Promise<PersistedByteIntegerRecord> {
  await artifacts.verify(input.sourceRef);
  const record = byteIntegerRecord(bytes, input);
  const recordRef = await artifacts.publish(Buffer.from(JSON.stringify({ schema: 'byte-integer-record/v1', record,
    source: input.sourceRef, conversion: { representation: 'unsigned_integer', endian: input.endian, domain: input.domain, padding: input.padding } })));
  return Object.freeze({ record, recordRef: Object.freeze({ ...recordRef }) });
}
export function integerToBytes(value: string, byteLength: number, endian: Endian): Buffer {
  checkEndian(endian);
  const integer = unsigned(value);
  if (!Number.isSafeInteger(byteLength) || byteLength < 1 || byteLength > 1024) throw new Error('byte width outside input range');
  if (integer >= (1n << BigInt(byteLength * 8))) throw new Error('integer does not fit explicit byte width');
  const bytes = Buffer.from(integer.toString(16).padStart(byteLength * 2, '0'), 'hex');
  return endian === 'big' ? bytes : bytes.reverse();
}
function checkEndian(endian: Endian): void { if (endian !== 'big' && endian !== 'little') throw new Error('explicit big/little endian required'); }
function unsigned(value: string): bigint {
  if (value.startsWith('-')) throw new Error('unsigned integer required');
  if (!/^(?:0|[1-9][0-9]*)$/.test(value)) throw new Error('canonical unsigned decimal required');
  if (value.length > 1234) throw new Error('integer outside input range (4096 bits)');
  const integer = BigInt(value);
  if (integer.toString(2).length > 4096) throw new Error('integer outside input range (4096 bits)');
  return integer;
}
function gcd(a: bigint, b: bigint): bigint { while (b) [a, b] = [b, a % b]; return a; }
function modPow(a: bigint, e: bigint, m: bigint): bigint {
  let result = 1n % m; a %= m;
  while (e) { if (e & 1n) result = result * a % m; a = a * a % m; e >>= 1n; }
  return result;
}

export interface CapabilityGap {
  status: 'needs_capability'; missing: string; reason: string; availableAlternatives: string[]; evidenceRef?: ArtifactReference;
}
export interface ArithmeticCapability {
  status: 'available'; backend: 'python_integer_arithmetic'; operations: ['gcd', 'mod_inverse', 'mod_pow'];
  maxBits: 4096; maxTimeoutMs: 5000; evidenceRef: ArtifactReference; jobId: string;
}
export interface VerifiedOptionalBackend {
  status: 'available'; name: 'sympy' | 'gmpy2' | 'z3'; version: string; operations: string[];
  maxBits: number; maxTimeoutMs: number; evidenceRef: ArtifactReference; jobId: string;
}
export interface OptionalBackendMatrix {
  status: 'probed' | 'probe_failed'; backends: Record<'sympy' | 'gmpy2' | 'z3',
    { available: boolean; version?: string; operations: string[]; reason?: string }>;
  evidenceRef: ArtifactReference; jobId: string;
}
export type ArithmeticInput =
  | { operation: 'gcd'; a: string; b: string; timeoutMs?: number }
  | { operation: 'mod_inverse'; a: string; modulus: string; timeoutMs?: number }
  | { operation: 'mod_pow'; a: string; exponent: string; modulus: string; timeoutMs?: number };

// Fixed benign integer operations only; no arbitrary Python source or cryptanalytic routines.
const PROBE = `import json, math, sys
ok = math.gcd(54,24)==6 and pow(3,-1,11)==4 and pow(5,3,23)==10
print(json.dumps({"self_check":ok,"python":sys.version,"backend":"python_integer_arithmetic"}))
sys.exit(0 if ok else 1)
`;
const PROBE_BACKENDS = `import json, importlib, sys
out={}
checks={
 'sympy': (['gcd','factorint'], lambda m: int(m.gcd(54,24))==6 and m.factorint(15)=={3:1,5:1}),
 'gmpy2': (['gcd','invert'], lambda m: int(m.gcd(54,24))==6 and int(m.invert(3,11))==4),
 'z3': (['integer_constraints'], lambda m: (lambda x,s: (s.add(x==7),s.check(),s.model().eval(x).as_long()==7)[-1])(m.Int('x'),m.Solver()) and str((lambda s: s.check())(m.Solver()))=='sat')
}
for name,(ops,check) in checks.items():
 try:
  m=importlib.import_module(name)
  if not check(m): raise RuntimeError('functional self-check failed')
  out[name]={'available':True,'version':str(getattr(m,'__version__',getattr(m,'__versionstr__',getattr(m,'Z3_VERSION_STRING','unknown')))),'operations':ops}
 except Exception as e: out[name]={'available':False,'operations':[],'reason':type(e).__name__+': '+str(e)[:240]}
print(json.dumps({'backends':out,'python':sys.version}))
`;
const CALCULATE = `import json, math, sys
x=json.loads(sys.argv[1]); a=int(x["a"])
if x["operation"]=="gcd": v=math.gcd(a,int(x["b"]))
elif x["operation"]=="mod_inverse": v=pow(a,-1,int(x["modulus"]))
elif x["operation"]=="mod_pow": v=pow(a,int(x["exponent"]),int(x["modulus"]))
else: raise ValueError("unsupported operation")
print(json.dumps({"operation":x["operation"],"input":x,"value":str(v)}))
`;

export class PythonArithmetic {
  private capability?: Promise<ArithmeticCapability | CapabilityGap>;
  private backendMatrix?: Promise<OptionalBackendMatrix>;
  constructor(private readonly runtime: ToolRuntime, private readonly artifacts: ArtifactStore, private readonly taskId: string, private readonly python = 'python3') {}

  private async execute(script: string, input: string | undefined, timeoutMs: number): Promise<{ output: string; evidenceRef: ArtifactReference; jobId: string; succeeded: boolean }> {
    const command = [this.python, '-I', '-c', script, ...(input === undefined ? [] : [input])];
    const job = await this.runtime.jobStart({ taskId: this.taskId, command, timeoutMs, maxRetainedBytes: 65536, effect: 'local_rebuildable' });
    while (this.runtime.jobStatus(job.id)?.status === 'running') await new Promise(resolve => setTimeout(resolve, 5));
    const record = this.runtime.jobStatus(job.id)!;
    const read = await this.runtime.jobRead(job.id, 0, 65536);
    const evidenceRef = await this.runtime.publishJobEvidence(job.id, 0, read.nextCursor);
    return { output: read.bytes.toString('utf8'), evidenceRef, jobId: job.id, succeeded: record.status === 'completed' && record.exitCode === 0 };
  }

  probe(): Promise<ArithmeticCapability | CapabilityGap> {
    return this.capability ??= this.selfCheck();
  }
  private async selfCheck(): Promise<ArithmeticCapability | CapabilityGap> {
    const result = await this.execute(PROBE, undefined, 2000);
    let passed = false;
    try { passed = JSON.parse(result.output).self_check === true; } catch { /* raw error is retained */ }
    if (!result.succeeded || !passed) return { status: 'needs_capability', missing: 'python_integer_arithmetic', reason: 'Python gcd/inverse/modular-power functional self-check failed; inspect retained job output', availableAlternatives: [], evidenceRef: result.evidenceRef };
    return { status: 'available', backend: 'python_integer_arithmetic', operations: ['gcd', 'mod_inverse', 'mod_pow'], maxBits: 4096, maxTimeoutMs: 5000, evidenceRef: result.evidenceRef, jobId: result.jobId };
  }

  async probeBackendMatrix(): Promise<OptionalBackendMatrix> {
    return this.backendMatrix ??= (async () => {
      const result = await this.execute(PROBE_BACKENDS, undefined, 2500);
      const empty = { sympy: { available: false, operations: [], reason: 'backend probe failed' },
        gmpy2: { available: false, operations: [], reason: 'backend probe failed' },
        z3: { available: false, operations: [], reason: 'backend probe failed' } } as OptionalBackendMatrix['backends'];
      if (!result.succeeded) return { status: 'probe_failed', backends: empty, evidenceRef: result.evidenceRef, jobId: result.jobId };
      try {
        const parsed = JSON.parse(result.output) as { backends?: Record<string, { available?: unknown; version?: unknown; operations?: unknown; reason?: unknown }> };
        const names = ['sympy', 'gmpy2', 'z3'] as const;
        const backends = Object.fromEntries(names.map(name => {
          const entry = parsed.backends?.[name];
          if (!entry || typeof entry.available !== 'boolean' || !Array.isArray(entry.operations) || entry.operations.some(op => typeof op !== 'string')) {
            return [name, { available: false, operations: [], reason: 'backend probe output invalid' }];
          }
          return [name, { available: entry.available, operations: entry.operations as string[],
            ...(entry.version === undefined ? {} : { version: String(entry.version) }),
            ...(entry.reason === undefined ? {} : { reason: String(entry.reason) }) }];
        })) as OptionalBackendMatrix['backends'];
        return { status: 'probed', backends, evidenceRef: result.evidenceRef, jobId: result.jobId };
      } catch { return { status: 'probe_failed', backends: empty, evidenceRef: result.evidenceRef, jobId: result.jobId }; }
    })();
  }

  async requireCapability(name: string): Promise<ArithmeticCapability | VerifiedOptionalBackend | CapabilityGap> {
    const verified = await this.probe();
    if (name === 'python_integer_arithmetic') return verified;
    if (name === 'sympy' || name === 'gmpy2' || name === 'z3') {
      const matrix = await this.probeBackendMatrix(); const backend = matrix.backends[name];
      if (backend.available && backend.version) return { status: 'available', name, version: backend.version,
        operations: [...backend.operations], maxBits: 4096, maxTimeoutMs: 2500, evidenceRef: matrix.evidenceRef, jobId: matrix.jobId };
      return { status: 'needs_capability', missing: name, reason: matrix.status === 'probed' ? backend.reason ?? `${name} functional self-check unavailable` : 'backend matrix probe failed',
        availableAlternatives: verified.status === 'available' ? ['python_integer_arithmetic'] : [], evidenceRef: matrix.evidenceRef };
    }
    return { status: 'needs_capability', missing: name, reason: `${name} is not probed or provided by this benign integer backend; requires a separately verified implementation for the requested operation and input range`, availableAlternatives: verified.status === 'available' ? ['python_integer_arithmetic'] : [], evidenceRef: verified.evidenceRef };
  }

  async compute(input: ArithmeticInput): Promise<CapabilityGap | { status: 'computed'; value: string; verified: true; evidenceRef: ArtifactReference; inputRef: ArtifactReference; jobId: string }> {
    // All cheap preconditions run before capability probing or starting a compute job.
    const a = unsigned(input.a);
    const timeoutMs = input.timeoutMs ?? 2000;
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 5000) throw new Error('arithmetic timeout outside 1..5000 ms');
    let b = 0n; let modulus = 0n; let exponent = 0n;
    if (input.operation === 'gcd') b = unsigned(input.b);
    else if (input.operation === 'mod_inverse' || input.operation === 'mod_pow') {
      modulus = unsigned(input.modulus);
      if (modulus < 2n) throw new Error('modulus must be at least 2');
      if (input.operation === 'mod_inverse' && gcd(a, modulus) !== 1n) throw new Error('inverse requires coprime a and modulus');
      if (input.operation === 'mod_pow') exponent = unsigned(input.exponent);
    } else throw new Error('unsupported arithmetic operation');
    const capability = await this.probe(); if (capability.status !== 'available') return capability;
    const inputRef = await this.artifacts.publish(Buffer.from(JSON.stringify(input)));
    const result = await this.execute(CALCULATE, JSON.stringify(input), timeoutMs);
    if (!result.succeeded) return { status: 'needs_capability', missing: `bounded_${input.operation}`, reason: 'Verified Python backend could not complete this bounded job; inspect retained transcript', availableAlternatives: ['python_integer_arithmetic'], evidenceRef: result.evidenceRef };
    const parsed = JSON.parse(result.output) as { value: string; operation: string; input: ArithmeticInput };
    const value = unsigned(parsed.value);
    if (parsed.operation !== input.operation || JSON.stringify(parsed.input) !== JSON.stringify(input)) throw new Error('arithmetic transcript input mismatch');
    const valid = input.operation === 'gcd' ? value === gcd(a, b) : input.operation === 'mod_inverse' ? value < modulus && (a * value) % modulus === 1n : value === modPow(a, exponent, modulus);
    if (!valid) throw new Error('independent host arithmetic verification failed');
    return { status: 'computed', value: parsed.value, verified: true, evidenceRef: result.evidenceRef, inputRef, jobId: result.jobId };
  }
}
