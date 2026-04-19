import re

TABLE_KEYWORDS = {
    "customers": ["customer", "customers", "client", "clients", "user", "users"],
    "orders":    ["order", "orders", "purchase", "purchases", "sale", "sales", "revenue", "spending"],
}

COLUMN_KEYWORDS = {
    "amount":      ["amount", "spending", "revenue", "value", "total", "price", "cost", "money"],
    "name":        ["name", "customer name", "client name"],
    "country":     ["country", "location", "region", "nation"],
    "order_date":  ["date", "order date", "when"],
    "id":          ["id", "identifier"],
}

# Ordered so longer phrases are matched first (prevents "greater than" matching "than")
CONDITION_PATTERNS = [
    (">=", ["at least", "minimum of", "no less than", "greater than or equal"]),
    ("<=", ["at most", "maximum of", "no more than", "less than or equal"]),
    (">",  ["greater than", "more than", "above", "over", "exceeds", "higher than"]),
    ("<",  ["less than", "below", "under", "fewer than", "lower than"]),
    ("=",  ["equal to", "equals", "exactly"]),
]

COUNTRY_MAP = {
    "usa": "USA", "us": "USA", "united states": "USA",
    "uk": "UK", "united kingdom": "UK",
    "germany": "Germany", "china": "China", "russia": "Russia",
    "mexico": "Mexico", "france": "France", "india": "India",
    "canada": "Canada", "australia": "Australia",
}


def extract_entities(query: str) -> dict:
    q = query.lower()

    # Tables
    tables = [t for t, kws in TABLE_KEYWORDS.items() if any(kw in q for kw in kws)]
    if not tables:
        tables = ["orders"]

    # Columns
    columns = [col for col, kws in COLUMN_KEYWORDS.items() if any(kw in q for kw in kws)]

    # Numbers
    numbers = [float(n) if "." in n else int(n)
               for n in re.findall(r"\b\d+(?:\.\d+)?\b", q)]

    # Conditions — match longest phrase first, stop after first match per operator
    conditions = []
    used_ops = set()
    for op, phrases in CONDITION_PATTERNS:
        if op in used_ops:
            continue
        for phrase in phrases:
            if phrase in q:
                after = q[q.find(phrase) + len(phrase):].strip()
                m = re.search(r"\d+(?:\.\d+)?", after)
                if m:
                    val = float(m.group()) if "." in m.group() else int(m.group())
                    conditions.append({"operator": op, "value": val})
                    used_ops.add(op)
                break

    # Countries
    countries = []
    for term, canonical in COUNTRY_MAP.items():
        pattern = r"\b" + re.escape(term) + r"\b"
        if re.search(pattern, q) and canonical not in countries:
            countries.append(canonical)

    # Limit (top N / first N / limit N)
    limit = None
    m = re.search(r"\b(?:top|first|limit)\s+(\d+)\b", q)
    if m:
        limit = int(m.group(1))

    return {
        "tables": tables,
        "columns": columns,
        "numbers": numbers,
        "conditions": conditions,
        "countries": countries,
        "limit": limit,
    }
