import { expect, it } from 'vitest';
import { parseLaunchArgs } from '../../apps/launcher/src/launch.js';
import { loadReleaseProfile } from '../../apps/cli/src/composition/releaseProfile.js';
import { readFile } from 'node:fs/promises';

it('launches with the custom Volcano plan model when no profile is supplied', async () => {
  const options = parseLaunchArgs([]);
  const profile = await loadReleaseProfile(options.profile!);
  const config = JSON.parse(await readFile(profile.opencode.configPath, 'utf8'));
  expect(config.model).toBe('volcano-plan/deepseek-v4.1-flash');
  expect(config.provider['volcano-plan'].options).toEqual({
    baseURL: '{env:VOLCANO_PLAN_BASE_URL}',
    apiKey: '{env:VOLCANO_PLAN_API_KEY}'
  });
});

it('preserves an explicit profile and rejects incomplete arguments', () => {
  expect(parseLaunchArgs(['--profile', '/tmp/custom.json']).profile).toBe('/tmp/custom.json');
  expect(() => parseLaunchArgs(['--profile'])).toThrow(/invalid argument/);
});
