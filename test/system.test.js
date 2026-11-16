import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { detectPackageManager, satisfiesRange } from '../src/system.js';

describe('detectPackageManager', () => {
  it('reads npm_config_user_agent', () => {
    assert.equal(detectPackageManager('npm/10.9.2 node/v22.12.0 darwin arm64 workspaces/false'), 'npm');
    assert.equal(detectPackageManager('pnpm/9.15.0 npm/? node/v22.12.0 darwin arm64'), 'pnpm');
    assert.equal(detectPackageManager('yarn/1.22.22 npm/? node/v20.18.0 linux x64'), 'yarn');
    assert.equal(detectPackageManager('bun/1.1.38 npm/? node/v22.6.0 linux x64'), 'bun');
  });

  it('returns null when unknown', () => {
    assert.equal(detectPackageManager(undefined), null);
    assert.equal(detectPackageManager(''), null);
    assert.equal(detectPackageManager('deno/2.0.0'), null);
  });
});

describe('satisfiesRange', () => {
  const range = '^20.19.0 || ^22.13.0 || >=24';
  it('checks the AveroaJS engines range', () => {
    assert.equal(satisfiesRange('20.19.0', range), true);
    assert.equal(satisfiesRange('20.18.3', range), false);
    assert.equal(satisfiesRange('21.7.0', range), false);
    assert.equal(satisfiesRange('22.12.0', range), false);
    assert.equal(satisfiesRange('22.13.1', range), true);
    assert.equal(satisfiesRange('23.0.0', range), false);
    assert.equal(satisfiesRange('24.0.0', range), true);
    assert.equal(satisfiesRange('26.1.0', range), true);
  });

  it('supports other comparators', () => {
    assert.equal(satisfiesRange('20.0.0', '>=20'), true);
    assert.equal(satisfiesRange('18.20.0', '>=20'), false);
    assert.equal(satisfiesRange('20.5.0', '>=20 <21'), true);
    assert.equal(satisfiesRange('21.0.0', '>=20 <21'), false);
    assert.equal(satisfiesRange('0.3.5', '^0.3.1'), true);
    assert.equal(satisfiesRange('0.4.0', '^0.3.1'), false);
    assert.equal(satisfiesRange('20.1.0', '20.1.0'), true);
  });

  it('returns null for ranges it does not understand', () => {
    assert.equal(satisfiesRange('20.0.0', '~20.1'), null);
    assert.equal(satisfiesRange('20.0.0', undefined), null);
  });
});
