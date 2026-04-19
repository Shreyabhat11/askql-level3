import sqlite3
import os

DB_PATH = os.path.join(os.path.dirname(__file__), "askql.db")


def get_connection():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    conn = get_connection()
    cur = conn.cursor()

    cur.executescript("""
        CREATE TABLE IF NOT EXISTS customers (
            id INTEGER PRIMARY KEY,
            name TEXT NOT NULL,
            country TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS orders (
            id INTEGER PRIMARY KEY,
            customer_id INTEGER NOT NULL,
            amount REAL NOT NULL,
            order_date TEXT NOT NULL,
            FOREIGN KEY (customer_id) REFERENCES customers(id)
        );
    """)

    cur.execute("SELECT COUNT(*) FROM customers")
    if cur.fetchone()[0] == 0:
        customers = [
            (1, "Alice Johnson", "USA"),
            (2, "Bob Smith", "UK"),
            (3, "Carlos Rivera", "Mexico"),
            (4, "Diana Prince", "USA"),
            (5, "Ethan Hunt", "Germany"),
            (6, "Fiona Green", "UK"),
            (7, "George Lee", "China"),
            (8, "Hannah Brown", "USA"),
            (9, "Ivan Petrov", "Russia"),
            (10, "Julia Roberts", "USA"),
        ]
        cur.executemany("INSERT INTO customers VALUES (?, ?, ?)", customers)

        orders = [
            (1,  1,  250.00, "2024-01-10"),
            (2,  2,  450.50, "2024-01-15"),
            (3,  1,  130.00, "2024-02-01"),
            (4,  3,  890.00, "2024-02-10"),
            (5,  4,  320.75, "2024-02-20"),
            (6,  5,  150.00, "2024-03-01"),
            (7,  2,  670.00, "2024-03-05"),
            (8,  6,  980.00, "2024-03-10"),
            (9,  7,  410.00, "2024-03-15"),
            (10, 8,  220.00, "2024-03-20"),
            (11, 1,  530.00, "2024-04-01"),
            (12, 9,  760.00, "2024-04-05"),
            (13, 10, 340.00, "2024-04-10"),
            (14, 3,  190.00, "2024-04-15"),
            (15, 4,  870.00, "2024-04-20"),
            (16, 5,  560.00, "2024-05-01"),
            (17, 6,  430.00, "2024-05-05"),
            (18, 7,  290.00, "2024-05-10"),
            (19, 8,  640.00, "2024-05-15"),
            (20, 10, 910.00, "2024-05-20"),
        ]
        cur.executemany("INSERT INTO orders VALUES (?, ?, ?, ?)", orders)

    conn.commit()
    conn.close()


def execute_query(sql: str):
    conn = get_connection()
    cur = conn.cursor()
    cur.execute(sql)
    rows = cur.fetchall()
    columns = [desc[0] for desc in cur.description] if cur.description else []
    conn.close()
    return [dict(zip(columns, row)) for row in rows]
