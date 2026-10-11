CREATE TABLE IF NOT EXISTS inventory_items (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    quantity INT NOT NULL DEFAULT 0,
    price NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO inventory_items (name, quantity, price)
SELECT 'Server Rack Cabinet 42U', 5, 899.99
WHERE NOT EXISTS (SELECT 1 FROM inventory_items WHERE name = 'Server Rack Cabinet 42U');
