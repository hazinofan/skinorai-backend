const fs = require('fs');
const path = require('path');
const assert = require('assert');
require('ts-node/register/transpile-only');

const tests = [];
const suiteStack = [];
const beforeEachStack = [];
const afterEachStack = [];

function formatName(name) {
  return [...suiteStack, name].join(' > ');
}

global.describe = (name, fn) => {
  suiteStack.push(name);
  beforeEachStack.push([]);
  afterEachStack.push([]);
  try { fn(); } finally {
    suiteStack.pop();
    beforeEachStack.pop();
    afterEachStack.pop();
  }
};
global.it = global.test = (name, fn) => {
  tests.push({
    name: formatName(name),
    fn,
    beforeEach: beforeEachStack.flat(),
    afterEach: [...afterEachStack].reverse().flat(),
  });
};
global.beforeEach = (fn) => {
  if (!beforeEachStack.length) throw new Error('beforeEach must be inside describe');
  beforeEachStack[beforeEachStack.length - 1].push(fn);
};
global.afterEach = (fn) => {
  if (!afterEachStack.length) throw new Error('afterEach must be inside describe');
  afterEachStack[afterEachStack.length - 1].push(fn);
};

function makeMock(implementation) {
  let defaultImpl = implementation;
  const once = [];
  function mockFn(...args) {
    mockFn.mock.calls.push(args);
    const impl = once.length ? once.shift() : defaultImpl;
    return impl ? impl.apply(this, args) : undefined;
  }
  mockFn.mock = { calls: [] };
  mockFn.mockImplementation = (fn) => { defaultImpl = fn; return mockFn; };
  mockFn.mockImplementationOnce = (fn) => { once.push(fn); return mockFn; };
  mockFn.mockReturnValue = (value) => mockFn.mockImplementation(() => value);
  mockFn.mockReturnValueOnce = (value) => mockFn.mockImplementationOnce(() => value);
  mockFn.mockResolvedValue = (value) => mockFn.mockImplementation(() => Promise.resolve(value));
  mockFn.mockResolvedValueOnce = (value) => mockFn.mockImplementationOnce(() => Promise.resolve(value));
  mockFn.mockRejectedValue = (error) => mockFn.mockImplementation(() => Promise.reject(error));
  mockFn.mockRejectedValueOnce = (error) => mockFn.mockImplementationOnce(() => Promise.reject(error));
  mockFn.mockClear = () => { mockFn.mock.calls.length = 0; return mockFn; };
  return mockFn;
}

global.jest = { fn: makeMock };

const ASYMMETRIC = Symbol('asymmetric');
function asymmetric(type, sample) { return { [ASYMMETRIC]: type, sample }; }

function matches(actual, expected) {
  if (expected && expected[ASYMMETRIC] === 'anything') return actual !== null && actual !== undefined;
  if (expected && expected[ASYMMETRIC] === 'objectContaining') {
    if (actual === null || typeof actual !== 'object') return false;
    return Object.entries(expected.sample).every(([key, value]) => matches(actual[key], value));
  }
  if (expected && expected[ASYMMETRIC] === 'arrayContaining') {
    if (!Array.isArray(actual)) return false;
    return expected.sample.every((wanted) => actual.some((item) => matches(item, wanted)));
  }
  if (Array.isArray(expected)) {
    return Array.isArray(actual) && actual.length === expected.length && expected.every((item, i) => matches(actual[i], item));
  }
  if (expected && typeof expected === 'object') {
    if (actual === null || typeof actual !== 'object') return false;
    const expectedKeys = Object.keys(expected);
    const actualKeys = Object.keys(actual);
    if (actualKeys.length !== expectedKeys.length) return false;
    return expectedKeys.every((key) => Object.prototype.hasOwnProperty.call(actual, key) && matches(actual[key], expected[key]));
  }
  return Object.is(actual, expected);
}

function partialMatches(actual, expected) {
  if (expected && expected[ASYMMETRIC]) return matches(actual, expected);
  if (expected && typeof expected === 'object' && !Array.isArray(expected)) {
    if (actual === null || typeof actual !== 'object') return false;
    return Object.entries(expected).every(([key, value]) => partialMatches(actual[key], value));
  }
  return matches(actual, expected);
}

function createMatchers(actual, negate = false) {
  const check = (condition, message) => {
    const passed = negate ? !condition : condition;
    if (!passed) throw new assert.AssertionError({ message: `${negate ? 'not ' : ''}${message}` });
  };
  const matchers = {
    toBe(expected) { check(Object.is(actual, expected), `expected ${JSON.stringify(actual)} to be ${JSON.stringify(expected)}`); },
    toEqual(expected) { check(matches(actual, expected), `expected values to be deeply equal\nactual: ${JSON.stringify(actual)}\nexpected: ${JSON.stringify(expected)}`); },
    toMatchObject(expected) { check(partialMatches(actual, expected), `expected object to match ${JSON.stringify(expected)}`); },
    toContain(expected) { check(actual != null && typeof actual.includes === 'function' && actual.includes(expected), `expected value to contain ${JSON.stringify(expected)}`); },
    toBeUndefined() { check(actual === undefined, `expected value to be undefined`); },
    toBeNull() { check(actual === null, `expected value to be null`); },
    toBeInstanceOf(expected) { check(actual instanceof expected, `expected value to be instance of ${expected?.name}`); },
    toHaveLength(expected) { check(actual != null && actual.length === expected, `expected length ${expected}, got ${actual?.length}`); },
    toBeLessThanOrEqual(expected) { check(typeof actual === 'number' && actual <= expected, `expected ${actual} <= ${expected}`); },
    toHaveBeenCalled() { check(Boolean(actual?.mock?.calls?.length), `expected mock to have been called`); },
    toHaveBeenCalledTimes(expected) { check(actual?.mock?.calls?.length === expected, `expected mock calls ${expected}, got ${actual?.mock?.calls?.length}`); },
    toHaveBeenCalledWith(...expectedArgs) {
      const calls = actual?.mock?.calls || [];
      check(calls.some((args) => matches(args, expectedArgs)), `expected mock to have been called with ${JSON.stringify(expectedArgs)}`);
    },
  };
  Object.defineProperty(matchers, 'not', { get: () => createMatchers(actual, !negate) });
  return matchers;
}

function expectFn(actual) {
  const matchers = createMatchers(actual);
  if (actual && typeof actual.then === 'function') {
    Object.defineProperty(matchers, 'resolves', {
      get: () => new Proxy({}, {
        get(_target, prop) {
          return async (...args) => {
            const value = await actual;
            return createMatchers(value)[prop](...args);
          };
        },
      }),
    });
    Object.defineProperty(matchers, 'rejects', {
      get: () => new Proxy({}, {
        get(_target, prop) {
          return async (...args) => {
            let error;
            try { await actual; } catch (caught) { error = caught; }
            if (error === undefined) throw new assert.AssertionError({ message: 'expected promise to reject' });
            return createMatchers(error)[prop](...args);
          };
        },
      }),
    });
  }
  return matchers;
}
expectFn.objectContaining = (sample) => asymmetric('objectContaining', sample);
expectFn.arrayContaining = (sample) => asymmetric('arrayContaining', sample);
expectFn.anything = () => asymmetric('anything');
global.expect = expectFn;

function discover(root, suffix) {
  const found = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) found.push(...discover(full, suffix));
    else if (entry.name.endsWith(suffix)) found.push(full);
  }
  return found.sort();
}

const mode = process.argv[2] || 'unit';
const root = process.cwd();
const files = mode === 'e2e'
  ? discover(path.join(root, 'test'), '.e2e-spec.ts')
  : discover(path.join(root, 'src'), '.spec.ts');
for (const file of files) require(file);

(async () => {
  let failed = 0;
  for (const item of tests) {
    try {
      for (const hook of item.beforeEach) await hook();
      await item.fn();
      console.log(`✓ ${item.name}`);
    } catch (error) {
      failed += 1;
      console.error(`✗ ${item.name}`);
      console.error(error?.stack || error);
    } finally {
      for (const hook of item.afterEach) {
        try { await hook(); } catch (error) {
          failed += 1;
          console.error(`✗ ${item.name} (afterEach)`);
          console.error(error?.stack || error);
        }
      }
    }
  }
  console.log(`\n${tests.length - failed}/${tests.length} tests passed`);
  process.exitCode = failed ? 1 : 0;
})();
