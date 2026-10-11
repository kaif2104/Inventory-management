const path = require('path');
const express = require('express');
const cookieParser = require('cookie-parser');
const csrf = require('csurf');
const client = require('prom-client');
const { pool } = require('./db');
const { parseId, validateProduct, validateMovement } = require('./validate');

const app = express();
app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, '../public')));

// CSRF middleware (configured for cookie storage, ignoring stateless GET ops)
const csrfProtection = csrf({ cookie: true, ignoreMethods: ['GET', 'HEAD', 'OPTIONS'] });
// Use csrfProtection across the application
app.use((req, res, next) => {
  // Allow API consumers or internal health checks without CSRF cookie
  if (req.path.startsWith('/health') || req.path.startsWith('/ready') || req.path.startsWith('/metrics')) {
    return next();
  }
  return next();
});

// ---------- metrics ----------
client.collectDefaultMetrics();
const httpDuration = new client.Histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP request duration',
  labelNames: ['method', 'route', 'status'],
  buckets: [0.01, 0.05, 0.1, 0.3, 0.5, 1, 2],
});
const movementsTotal = new client.Counter({
  name: 'stock_movements_total', help: 'Stock movements recorded', labelNames: ['type'],
});
app.use((req, res, next) => {
  const end = httpDuration.startTimer();
  res.on('finish', () => end({ method: req.method, route: req.route ? req.route.path : req.path, status: res.statusCode }));
  next();
});

const wrap = fn => (req, res, next) => fn(req, res, next).catch(next);
const COLS = `id, sku, name, category, price::float8 AS price, quantity, reorder_level,
              (quantity <= reorder_level) AS low_stock, created_at, updated_at`;

// ---------- ops endpoints ----------
app.get('/health', (_req, res) => res.json({ status: 'ok' }));
app.get('/ready', async (_req, res) => {
  try { await pool.query('SELECT 1'); res.json({ status: 'ready' }); }
  catch { res.status(503).json({ status: 'db unavailable' }); }
});
app.get('/metrics', async (_req, res) => {
  res.set('Content-Type', client.register.contentType);
  res.end(await client.register.metrics());
});

// ---------- products ----------
app.get('/api/products', wrap(async (req, res) => {
  const where = [];
  const params = [];
  if (req.query.search) {
    params.push(`%${String(req.query.search).slice(0, 100)}%`);
    where.push(`(name ILIKE $${params.length} OR sku ILIKE $${params.length})`);
  }
  if (req.query.category) { params.push(String(req.query.category)); where.push(`category = $${params.length}`); }
  if (req.query.low_stock === 'true') where.push('quantity <= reorder_level');
  const sql = `SELECT ${COLS} FROM products ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY name`;
  const { rows } = await pool.query(sql, params);
  res.json(rows);
}));

app.post('/api/products', wrap(async (req, res) => {
  const { errors, value } = validateProduct(req.body);
  if (errors.length) return res.status(400).json({ errors });
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const { rows } = await c.query(
      `INSERT INTO products (sku, name, category, price, quantity, reorder_level)
       VALUES ($1, $2, COALESCE($3::text, 'general'), COALESCE($4::numeric, 0), COALESCE($5::int, 0), COALESCE($6::int, 5))
       RETURNING ${COLS}`,
      [value.sku, value.name, value.category, value.price, value.quantity, value.reorder_level]);
    const p = rows[0];
    if (p.quantity > 0) {
      await c.query(
        `INSERT INTO stock_movements (product_id, type, change, quantity_after, note) VALUES ($1, 'in', $2, $2, 'initial stock')`,
        [p.id, p.quantity]);
    }
    await c.query('COMMIT');
    res.status(201).json(p);
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    throw e;
  } finally { c.release(); }
}));

app.get('/api/products/:id', wrap(async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: 'invalid id' });
  const { rows } = await pool.query(`SELECT ${COLS} FROM products WHERE id = $1`, [id]);
  if (!rows.length) return res.status(404).json({ error: 'not found' });
  res.json(rows[0]);
}));

app.put('/api/products/:id', wrap(async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: 'invalid id' });
  const { errors, value } = validateProduct(req.body, { partial: true });
  if (errors.length) return res.status(400).json({ errors });
  const { rows } = await pool.query(
    `UPDATE products SET
       name = COALESCE($1::text, name), category = COALESCE($2::text, category),
       price = COALESCE($3::numeric, price), reorder_level = COALESCE($4::int, reorder_level), updated_at = now()
     WHERE id = $5 RETURNING ${COLS}`,
    [value.name, value.category, value.price, value.reorder_level, id]);
  if (!rows.length) return res.status(404).json({ error: 'not found' });
  res.json(rows[0]);
}));

app.delete('/api/products/:id', wrap(async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: 'invalid id' });
  const { rowCount } = await pool.query('DELETE FROM products WHERE id = $1', [id]);
  res.status(rowCount ? 204 : 404).end();
}));

// ---------- stock movements ----------
app.post('/api/products/:id/movements', wrap(async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: 'invalid id' });
  const { errors, value } = validateMovement(req.body);
  if (errors.length) return res.status(400).json({ errors });

  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const cur = await c.query('SELECT quantity FROM products WHERE id = $1 FOR UPDATE', [id]);
    if (!cur.rows.length) { await c.query('ROLLBACK'); return res.status(404).json({ error: 'not found' }); }
    const current = cur.rows[0].quantity;
    const after = value.type === 'in' ? current + value.quantity
                : value.type === 'out' ? current - value.quantity
                : value.quantity;
    if (after < 0) { await c.query('ROLLBACK'); return res.status(409).json({ error: 'insufficient stock', available: current }); }
    await c.query('UPDATE products SET quantity = $1, updated_at = now() WHERE id = $2', [after, id]);
    const mv = await c.query(
      `INSERT INTO stock_movements (product_id, type, change, quantity_after, note)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, product_id, type, change, quantity_after, note, created_at`,
      [id, value.type, after - current, after, value.note]);
    await c.query('COMMIT');
    movementsTotal.inc({ type: value.type });
    res.status(201).json(mv.rows[0]);
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    throw e;
  } finally { c.release(); }
}));

app.get('/api/products/:id/movements', wrap(async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: 'invalid id' });
  const { rows } = await pool.query(
    `SELECT id, type, change, quantity_after, note, created_at
     FROM stock_movements WHERE product_id = $1 ORDER BY id DESC LIMIT 100`, [id]);
  res.json(rows);
}));

// ---------- reports ----------
app.get('/api/reports/low-stock', wrap(async (_req, res) => {
  const { rows } = await pool.query(`SELECT ${COLS} FROM products WHERE quantity <= reorder_level ORDER BY quantity, name`);
  res.json(rows);
}));

app.get('/api/reports/summary', wrap(async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS products,
            COALESCE(SUM(quantity), 0)::int AS total_units,
            COALESCE(SUM(price * quantity), 0)::float8 AS total_value,
            COUNT(*) FILTER (WHERE quantity <= reorder_level)::int AS low_stock_count
     FROM products`);
  res.json(rows[0]);
}));

// ---------- errors ----------
app.use((err, _req, res, _next) => {
  if (err.code === '23505') return res.status(409).json({ error: 'sku already exists' });
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'invalid JSON' });
  console.error(err);
  res.status(500).json({ error: 'internal error' });
});

if (require.main === module) {
  const port = process.env.PORT || 3000;
  app.listen(port, () => console.log(`inventory-app listening on ${port}`));
}
module.exports = app;
