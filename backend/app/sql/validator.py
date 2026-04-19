import re

BLOCKED = re.compile(
    r"\b(DROP|DELETE|UPDATE|INSERT|ALTER|TRUNCATE|CREATE|REPLACE|EXEC|EXECUTE|PRAGMA)\b",
    re.IGNORECASE,
)


def validate_sql(sql: str) -> tuple[bool, str]:
    stripped = sql.strip().upper()

    if not stripped.startswith("SELECT"):
        return False, "Only SELECT statements are allowed."

    if BLOCKED.search(sql):
        blocked_word = BLOCKED.search(sql).group(0)
        return False, f"Blocked keyword detected: {blocked_word}"

    if "--" in sql or "/*" in sql:
        return False, "SQL comments are not allowed."

    if ";" in sql[:-1]:
        return False, "Multiple statements are not allowed."

    return True, ""
