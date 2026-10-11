import os
import psycopg2
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

app = FastAPI(title="Inventory Management Microservice", version="1.0.0")

DB_URL = os.getenv("DATABASE_URL", "postgresql://prod_user:ProdSecurePassword2026!@prod-postgres:5432/inventory_db")
INSTANCE_ID = os.getenv("INSTANCE_ID", "default-instance")

class Item(BaseModel):
    name: str
    quantity: int
    price: float

def get_db_connection():
    return psycopg2.connect(DB_URL)

@app.get("/health")
def health_check():
    try:
        conn = get_db_connection()
        cur = conn.cursor()
        cur.execute("SELECT 1;")
        cur.close()
        conn.close()
        return {"status": "healthy", "instance": INSTANCE_ID, "database": "connected"}
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"Database unhealthy: {str(e)}")

@app.get("/inventory")
def list_inventory():
    conn = get_db_connection()
    cur = conn.cursor()
    cur.execute("SELECT id, name, quantity, price FROM inventory_items;")
    rows = cur.fetchall()
    cur.close()
    conn.close()
    items = [{"id": r[0], "name": r[1], "quantity": r[2], "price": float(r[3])} for r in rows]
    return {"items": items, "served_by": INSTANCE_ID}

@app.post("/inventory")
def add_item(item: Item):
    conn = get_db_connection()
    cur = conn.cursor()
    cur.execute(
        "INSERT INTO inventory_items (name, quantity, price) VALUES (%s, %s, %s) RETURNING id;",
        (item.name, item.quantity, item.price)
    )
    new_id = cur.fetchone()[0]
    conn.commit()
    cur.close()
    conn.close()
    return {"id": new_id, "name": item.name, "quantity": item.quantity, "price": item.price}
