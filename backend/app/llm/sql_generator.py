import re
import json

SCHEMA = """
Tables:
- customers(id INTEGER PK, name TEXT, country TEXT)
- orders(id INTEGER PK, customer_id INTEGER FK->customers.id, amount REAL, order_date TEXT)
"""

INTENT_HINTS = {
    "SUM":      "Use SUM() on a numeric column.",
    "AVG":      "Use AVG() on a numeric column.",
    "COUNT":    "Use COUNT(*) or COUNT(column).",
    "FILTER":   "Use WHERE clause with proper conditions.",
    "GROUP_BY": "Use GROUP BY with an aggregate (SUM/COUNT/AVG).",
    "TOP_N":    "Use ORDER BY ... DESC LIMIT N.",
    "JOIN":     "INNER JOIN customers ON orders.customer_id = customers.id.",
}

SYSTEM_PROMPT = (
    "You are a SQLite SQL expert. "
    "Output ONLY a single valid SELECT SQL statement. "
    "No explanations, no markdown, no backticks. "
    "End with a semicolon."
)


def build_prompt(query: str, intent: str, entities: dict) -> str:
    hint = INTENT_HINTS.get(intent, "")
    tables = ", ".join(entities.get("tables", ["orders"]))
    columns = ", ".join(entities.get("columns", [])) or "relevant columns"
    conditions = entities.get("conditions", [])
    countries = entities.get("countries", [])
    limit = entities.get("limit")

    cond_parts = []
    for c in conditions:
        cond_parts.append(f"column {c['operator']} {c['value']}")
    for country in countries:
        cond_parts.append(f"country = '{country}'")
    cond_str = ("Conditions: " + ", ".join(cond_parts)) if cond_parts else ""
    limit_str = f"Limit results to {limit} rows." if limit else ""

    return f"""{SYSTEM_PROMPT}

Schema:
{SCHEMA}

User question: {query}
Detected intent: {intent}
Hint: {hint}
Relevant tables: {tables}
Relevant columns: {columns}
{cond_str}
{limit_str}

SQL:"""


# ── Real LLM (Anthropic API) ─────────────────────────────────────────────────

def generate_sql_llm_real(query: str, intent: str, entities: dict, api_key: str) -> str:
    import urllib.request
    prompt = build_prompt(query, intent, entities)
    payload = json.dumps({
        "model": "claude-sonnet-4-20250514",
        "max_tokens": 256,
        "system": SYSTEM_PROMPT,
        "messages": [{"role": "user", "content": prompt}],
    }).encode()
    req = urllib.request.Request(
        "https://api.anthropic.com/v1/messages",
        data=payload,
        headers={
            "Content-Type": "application/json",
            "x-api-key": api_key,
            "anthropic-version": "2023-06-01",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = json.loads(resp.read())
        sql = data["content"][0]["text"].strip()
        sql = re.sub(r"^```sql\s*", "", sql, flags=re.IGNORECASE)
        sql = re.sub(r"```$", "", sql).strip()
        if not sql.upper().startswith("SELECT"):
            return _fallback(query, intent, entities)
        return sql if sql.endswith(";") else sql + ";"
    except Exception:
        return _fallback(query, intent, entities)


def generate_sql_llm(query: str, intent: str, entities: dict) -> str:
    return _fallback(query, intent, entities)


# ── Rule-based fallback ───────────────────────────────────────────────────────

def _fallback(query: str, intent: str, entities: dict) -> str:
    tables = entities.get("tables", ["orders"])
    columns_raw = " ".join(entities.get("columns", []))
    conditions = entities.get("conditions", [])
    countries = entities.get("countries", [])
    limit = entities.get("limit")
    q = query.lower()

    # Decide if join is needed
    needs_name = "name" in columns_raw or "name" in q
    needs_country = "country" in columns_raw or "country" in q
    both_tables = "customers" in tables and "orders" in tables
    use_join = intent == "JOIN" or both_tables or (needs_name and "amount" in q)

    primary = "orders" if "orders" in tables else (tables[0] if tables else "orders")
    primary_is_customers = primary == "customers" and not use_join

    # ── Base query ────────────────────────────────────────────────────────────
    if intent == "SUM":
        col = "amount" if not primary_is_customers else "id"
        base = f"SELECT SUM({col}) AS total FROM {primary}"

    elif intent == "AVG":
        col = "amount" if not primary_is_customers else "id"
        base = f"SELECT AVG({col}) AS average FROM {primary}"

    elif intent == "COUNT":
        base = f"SELECT COUNT(*) AS count FROM {primary}"

    elif intent == "GROUP_BY":
        if needs_country or "country" in q:
            base = (
                "SELECT customers.country, SUM(orders.amount) AS total, COUNT(*) AS orders "
                "FROM orders INNER JOIN customers ON orders.customer_id = customers.id "
                "GROUP BY customers.country ORDER BY total DESC"
            )
        else:
            base = (
                "SELECT customers.name, SUM(orders.amount) AS total, COUNT(*) AS orders "
                "FROM orders INNER JOIN customers ON orders.customer_id = customers.id "
                "GROUP BY customers.id ORDER BY total DESC"
            )

    elif intent == "TOP_N":
        n = limit or 5
        if needs_name or use_join:
            base = (
                f"SELECT customers.name, SUM(orders.amount) AS total "
                f"FROM orders INNER JOIN customers ON orders.customer_id = customers.id "
                f"GROUP BY customers.id ORDER BY total DESC LIMIT {n}"
            )
        elif primary_is_customers:
            base = f"SELECT * FROM customers LIMIT {n}"
        else:
            base = f"SELECT * FROM orders ORDER BY amount DESC LIMIT {n}"

    elif use_join or intent == "JOIN":
        base = (
            "SELECT customers.name, customers.country, orders.amount, orders.order_date "
            "FROM orders INNER JOIN customers ON orders.customer_id = customers.id"
        )

    elif primary_is_customers:
        base = "SELECT * FROM customers"

    else:
        base = "SELECT * FROM orders"

    # ── WHERE clauses ─────────────────────────────────────────────────────────
    where = []

    # Numeric conditions — only apply to amount (not to FILTER conditions that
    # were double-matched as "greater than 500 AND = 500"). De-duplicate by op.
    seen_ops = set()
    for c in conditions:
        op = c["operator"]
        if op not in seen_ops:
            seen_ops.add(op)
            # Pick the right table prefix
            if use_join or "JOIN" in base.upper():
                where.append(f"orders.amount {op} {c['value']}")
            else:
                where.append(f"amount {op} {c['value']}")

    for country in countries:
        if use_join or "JOIN" in base.upper():
            where.append(f"customers.country = '{country}'")
        elif primary_is_customers:
            where.append(f"country = '{country}'")
        else:
            where.append(f"customers.country = '{country}'")

    # ── Inject WHERE safely ───────────────────────────────────────────────────
    if where and "WHERE" not in base.upper():
        upper = base.upper()
        for kw in ("GROUP BY", "ORDER BY", "LIMIT"):
            idx = upper.find(kw)
            if idx != -1:
                base = base[:idx] + "WHERE " + " AND ".join(where) + " " + base[idx:]
                break
        else:
            base += " WHERE " + " AND ".join(where)

    # ── LIMIT ─────────────────────────────────────────────────────────────────
    if limit and "LIMIT" not in base.upper():
        base += f" LIMIT {limit}"

    return base.strip() + ";"


def _agg_col(columns_raw: str, default: str) -> str:
    for col in ["amount", "id", "customer_id"]:
        if col in columns_raw:
            return col
    return default
