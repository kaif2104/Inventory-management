const test = require('node:test');
const assert = require('node:assert');
const app = require('../src/server');
const { parseId, validateProduct, validateMovement } = require('../src/validate');

let server, base;
test.before(() => new Promise(r => { server = app.listen(0, () => { base = `http://127.0.0.1:${server.address().port}`; r(); }); }));
test.after(() => server.close());

const post = (url, body) => fetch(base + url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

test('GET /health', async () => {
  const res = await fetch(`${base}/health`);
  assert.strictEqual(res.status, 200);
  assert.deepStrictEqual(await res.json(), { status: 'ok' });
});

test('GET /metrics exposes prometheus text', async () => {
  const res = await fetch(`${base}/metrics`);
  assert.strictEqual(res.status, 200);
  assert.match(await res.text(), /http_request_duration_seconds/);
});

test('POST /api/products rejects invalid body (no DB needed)', async () => {
  const res = await post('/api/products', { name: '', price: -1 });
  assert.strictEqual(res.status, 400);
  assert.ok((await res.json()).errors.length >= 2);
});

test('invalid id returns 400', async () => {
  assert.strictEqual((await fetch(`${base}/api/products/abc`)).status, 400);
});

test('movement with bad type returns 400', async () => {
  assert.strictEqual((await post('/api/products/1/movements', { type: 'steal', quantity: 1 })).status, 400);
});

test('validators', () => {
  assert.strictEqual(parseId('12'), 12);
  assert.strictEqual(parseId('-1'), null);
  assert.strictEqual(validateProduct({ sku: 'A1', name: 'Pen', price: 1.234, quantity: 10 }).errors.length, 0);
  assert.strictEqual(validateProduct({ sku: 'A1', name: 'Pen', price: 1.234 }).value.price, 1.23);
  assert.ok(validateProduct({}, { partial: true }).errors.length > 0);
  assert.strictEqual(validateMovement({ type: 'adjust', quantity: 0 }).errors.length, 0);
  assert.ok(validateMovement({ type: 'out', quantity: 0 }).errors.length > 0);
});
