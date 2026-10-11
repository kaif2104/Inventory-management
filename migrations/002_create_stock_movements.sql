CREATE TABLE stock_movements (
  id             SERIAL PRIMARY KEY,
  product_id     INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  type           TEXT NOT NULL CHECK (type IN ('in', 'out', 'adjust')),
  change         INTEGER NOT NULL,
  quantity_after INTEGER NOT NULL CHECK (quantity_after >= 0),
  note           TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_movements_product ON stock_movements (product_id, created_at DESC);
