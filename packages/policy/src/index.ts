import { DataClassSchema, type ChallengeId, type LeaseId, type SessionId, type TaskId } from '@ctf/contracts';

export interface SessionBinding {
  sessionId: SessionId;
  challengeId: ChallengeId;
  task: TaskId;
  lease: LeaseId;
  capabilities: ReadonlySet<string>;
  scope: string;
  expiresAt: string;
}

export interface PolicyDecision {
  allowed: boolean;
  reason?: string;
}

export class PolicyEngine {
  private readonly bindings = new Map<string, SessionBinding>();

  register(binding: SessionBinding): void {
    if (this.bindings.has(binding.sessionId)) throw new Error('session binding immutable');
    this.bindings.set(binding.sessionId, Object.freeze({ ...binding, capabilities: new Set(binding.capabilities) }));
  }

  binding(sessionId: SessionId): SessionBinding {
    const binding = this.bindings.get(sessionId);
    if (!binding) throw new Error('unbound session');
    if (new Date(binding.expiresAt).getTime() <= Date.now()) throw new Error('lease expired');
    return { ...binding, capabilities: new Set(binding.capabilities) };
  }

  authorizeTool(input: {
    claimedSessionId?: string;
    sessionId: SessionId;
    capability: string;
    scope: string;
    lease: LeaseId;
  }): PolicyDecision {
    const binding = this.binding(input.sessionId);
    // Model self-reported identity is deliberately ignored; ToolContext is authoritative.
    if (input.lease !== binding.lease) return { allowed: false, reason: 'lease mismatch' };
    if (input.scope !== binding.scope) return { allowed: false, reason: 'scope mismatch' };
    if (!binding.capabilities.has(input.capability)) return { allowed: false, reason: 'capability not allowlisted' };
    return { allowed: true };
  }
}

const modelVisibleClasses = new Set(['challenge_analysis_data', 'allowed_excerpt']);

export function isModelVisible(dataClass: string): boolean {
  return DataClassSchema.safeParse(dataClass).success && modelVisibleClasses.has(dataClass);
}

export class ModelDataGateway {
  request<T>(input: { dataClass: string; value: T; operation: string }): T {
    if (!isModelVisible(input.dataClass)) throw new Error(`provider path blocked for ${input.dataClass}`);
    if (containsSecret(input.value)) throw new Error('control secret blocked');
    return input.value;
  }

  artifactExcerpt(input: { dataClass: string; bytes: Uint8Array; maxBytes: number }): Buffer {
    if (input.dataClass === 'artifact_bulk') throw new Error('artifact_bulk requires explicit policy, not mechanical slicing');
    if (!isModelVisible(input.dataClass)) throw new Error(`provider path blocked for ${input.dataClass}`);
    return Buffer.from(input.bytes).subarray(0, Math.min(input.maxBytes, input.bytes.length));
  }
}

export function safeEnvironment(extra: Record<string, string> = {}): Record<string, string> {
  for (const key of Object.keys(extra)) if (isSecretKey(key)) throw new Error(`secret-like environment key rejected: ${key}`);
  const env: Record<string, string> = {
    PATH: process.env.PATH ?? '/usr/bin:/bin:/usr/sbin:/sbin',
    HOME: process.env.HOME ?? '/tmp',
    LANG: process.env.LANG ?? 'C.UTF-8',
    TZ: process.env.TZ ?? 'UTC',
    ...Object.fromEntries(Object.entries(extra).filter(([key]) => !isSecretKey(key)))
  };
  for (const [key, value] of Object.entries(env)) {
    if (isSecretKey(key)) throw new Error(`secret-like environment key rejected: ${key}`);
    if (containsSecret(value)) throw new Error(`secret-like environment value rejected: ${key}`);
  }
  return env;
}

function isSecretKey(key: string): boolean {
  return /(?:secret|token|api[_-]?key|credential|password|platform)/i.test(key);
}

export function containsSecret(value: unknown, depth = 0): boolean {
  if (depth > 8) return false;
  if (typeof value === 'string') {
    return /(?:OPENAI_API_KEY|ANTHROPIC_API_KEY|AWS_SECRET_ACCESS_KEY|BEGIN [A-Z ]*PRIVATE KEY)/.test(value);
  }
  if (value && typeof value === 'object') return Object.values(value).some(item => containsSecret(item, depth + 1));
  return false;
}
