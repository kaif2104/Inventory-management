// usage: node src/migrate.js            -> apply pending migrations
//        node src/migrate.js --validate -> apply inside a transaction, then ROLLBACK
const fs = require('fs');
const path = require('path');
const { pool } = require('./db');

(async () => {
  const validate = process.argv.includes('--validate');
  const dir = path.join(__dirname, '../migrations');
  const files = fs.readdirSync(dir).filter(f => /^\d+_.+\.sql$/.test(f)).sort();
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    await c.query('CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ DEFAULT now())');
    const { rows } = await c.query('SELECT name FROM schema_migrations');
    const applied = new Set(rows.map(r => r.name));
    for (const f of files.filter(f => !applied.has(f))) {
      console.log(`${validate ? 'validating' : 'applying'} ${f}`);
      await c.query(fs.readFileSync(path.join(dir, f), 'utf8'));
      await c.query('INSERT INTO schema_migrations (name) VALUES ($1)', [f]);
    }
    await c.query(validate ? 'ROLLBACK' : 'COMMIT');
    console.log(validate ? 'migrations valid' : 'migrations applied');
  } catch (e) {
    await c.query('ROLLBACK');
    console.error('migration failed:', e.message);
    process.exitCode = 1;
  } finally { c.release(); await pool.end(); }
})();
