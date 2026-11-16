import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { databaseName, toValidPackageName, validatePackageName } from '../src/name.js';

describe('validatePackageName', () => {
  it('accepts valid names', () => {
    for (const name of ['my-app', 'app2', 'a.b', 'my_app', '@acme/api', '@acme/my-app.v2', 'x'.repeat(214)]) {
      assert.equal(validatePackageName(name).valid, true, name);
    }
  });

  const invalid = {
    '': /empty/,
    'My-App': /lowercase/,
    '.hidden': /period/,
    _private: /underscore/,
    'my app': /URL-friendly/,
    ' app': /spaces/,
    'a/b': /@scope\/name/,
    '@acme/': /URL-friendly|scope/,
    'app!': /~'!\(\)\*/,
    node_modules: /reserved/,
    'favicon.ico': /reserved/,
    http: /core module/,
    fs: /core module/,
    'é-app': /URL-friendly/,
    [`a${'x'.repeat(214)}`]: /214/,
  };
  for (const [name, problem] of Object.entries(invalid)) {
    it(`rejects ${JSON.stringify(name)}`, () => {
      const result = validatePackageName(name);
      assert.equal(result.valid, false);
      assert.match(result.problems.join('\n'), problem);
    });
  }

  it('rejects non-strings', () => {
    assert.equal(validatePackageName(undefined).valid, false);
  });
});

describe('toValidPackageName', () => {
  it('suggests a valid name', () => {
    assert.equal(toValidPackageName('My App'), 'my-app');
    assert.equal(toValidPackageName('  _Hello   World!! '), 'hello-world');
    assert.equal(toValidPackageName('.config'), 'config');
    assert.equal(toValidPackageName('Ünïcode App'), 'n-code-app');
  });

  it('falls back to averoa-app', () => {
    assert.equal(toValidPackageName('!!!'), 'averoa-app');
    assert.equal(toValidPackageName('http'), 'averoa-app');
  });
});

describe('databaseName', () => {
  it('derives a database name from the package name', () => {
    assert.equal(databaseName('my-app'), 'my_app');
    assert.equal(databaseName('@acme/shop.api'), 'shop_api');
    assert.equal(databaseName('2fast'), 'db_2fast');
    assert.equal(databaseName('---'), 'averoa');
    assert.equal(databaseName('a'.repeat(100)).length, 63);
  });
});
