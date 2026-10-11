const { Pool } = require('pg');
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgres://inventory:inventory@localhost:5432/inventory',
});
module.exports = { pool };
