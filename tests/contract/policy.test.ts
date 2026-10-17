import { describe, expect, it } from 'vitest';
import { ModelDataGateway, PolicyEngine, containsSecret, isModelVisible, safeEnvironment } from '../../packages/policy/src/index.js';
import type { ChallengeId, LeaseId, SessionId, TaskId } from '../../packages/contracts/src/index.js';

function binding() {
  return {
    sessionId: 's1' as SessionId,
    challengeId: 'c1' as ChallengeId,
    task: 't1' as TaskId,
    lease: 'l1' as LeaseId,
    capabilities: new Set(['workspace.read']),
    scope: 'http://127.0.0.1:9999',
    expiresAt: new Date(Date.now() + 60000).toISOString()
  };
}

describe('policy and model data gateway', () => {
  it('only exposes approved analysis classes and blocks bulk slicing', () => {
    expect(isModelVisible('challenge_analysis_data')).toBe(true);
    expect(isModelVisible('allowed_excerpt')).toBe(true);
    expect(isModelVisible('control_secret')).toBe(false);
    expect(isModelVisible('artifact_bulk')).toBe(false);
    expect(isModelVisible('not_a_class')).toBe(false);
  });

  it('scans provider requests and tool environments for secrets', () => {
    const gateway = new ModelDataGateway();
    expect(() => gateway.request({ dataClass: 'challenge_analysis_data', value: { text: 'OPENAI_API_KEY=bad' }, operation: 'test' })).toThrow(/secret/);
    expect(() => gateway.request({ dataClass: 'control_secret', value: 'value', operation: 'test' })).toThrow();
    expect(() => safeEnvironment({ PLATFORM_TOKEN: 'bad' })).toThrow(/secret/);
    expect(safeEnvironment({ A_VALID_PATH: '/tmp' })['A_VALID_PATH']).toBe('/tmp');
    expect(containsSecret({ nested: ['AWS_SECRET_ACCESS_KEY=bad'] })).toBe(true);
  });

  it('ignores model identity and rejects unbound, lease, scope, and capability mismatches', () => {
    const policy = new PolicyEngine();
    const b = binding();
    policy.register(b);
    expect(policy.authorizeTool({ claimedSessionId: 'model-claims', sessionId: b.sessionId, capability: 'workspace.read', scope: b.scope, lease: b.lease })).toEqual({ allowed: true });
    expect(policy.authorizeTool({ sessionId: b.sessionId, capability: 'workspace.read', scope: b.scope, lease: 'other' as LeaseId })).toMatchObject({ allowed: false });
    expect(policy.authorizeTool({ sessionId: b.sessionId, capability: 'workspace.read', scope: 'http://evil', lease: b.lease })).toMatchObject({ allowed: false });
    expect(policy.authorizeTool({ sessionId: b.sessionId, capability: 'platform.intent.submit', scope: b.scope, lease: b.lease })).toMatchObject({ allowed: false });
    expect(() => policy.authorizeTool({ sessionId: 'unbound' as SessionId, capability: 'workspace.read', scope: b.scope, lease: b.lease })).toThrow(/unbound/);
  });
});
