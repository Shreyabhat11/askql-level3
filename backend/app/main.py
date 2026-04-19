import os
import sys
import pickle
import time
from contextlib import asynccontextmanager
from datetime import datetime

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

sys.path.insert(0, os.path.dirname(__file__))

from db import init_db, execute_query, get_connection
from ml.preprocess import preprocess
from ml.entity_extractor import extract_entities
from llm.sql_generator import generate_sql_llm, generate_sql_llm_real
from sql.validator import validate_sql

ML_DIR = os.path.join(os.path.dirname(__file__), "ml")
vectorizer = None
clf = None
query_history = []
_history_counter = 0


def load_models():
    global vectorizer, clf
    vec_path = os.path.join(ML_DIR, "vectorizer.pkl")
    mdl_path = os.path.join(ML_DIR, "intent_model.pkl")
    if not os.path.exists(vec_path) or not os.path.exists(mdl_path):
        _train_inline()
    with open(vec_path, "rb") as f:
        vectorizer = pickle.load(f)
    with open(mdl_path, "rb") as f:
        clf = pickle.load(f)


def _train_inline():
    import importlib.util
    train_path = os.path.join(ML_DIR, "train.py")
    orig = os.getcwd()
    os.chdir(ML_DIR)
    spec = importlib.util.spec_from_file_location("train", train_path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    mod.train()
    os.chdir(orig)


def predict_intent(query: str) -> tuple:
    X = vectorizer.transform([preprocess(query)])
    label = clf.predict(X)[0]
    proba = clf.predict_proba(X)[0]
    conf = round(float(proba[list(clf.classes_).index(label)]) * 100, 1)
    return label, conf


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    load_models()
    yield


app = FastAPI(title="AskQL 3.0", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


class AskRequest(BaseModel):
    query: str
    use_llm: bool = False
    anthropic_key: str = ""


class AskResponse(BaseModel):
    sql: str
    result: list
    intent: str
    confidence: float
    entities: dict
    row_count: int
    duration_ms: float


class HistoryItem(BaseModel):
    id: int
    query: str
    sql: str
    intent: str
    confidence: float
    row_count: int
    timestamp: str
    success: bool


class SchemaColumn(BaseModel):
    name: str
    type: str
    pk: bool
    notnull: bool


class SchemaTable(BaseModel):
    name: str
    columns: list[SchemaColumn]
    row_count: int
    sample: list[dict]


@app.post("/ask", response_model=AskResponse)
def ask(req: AskRequest):
    global _history_counter
    query = req.query.strip()
    if not query:
        raise HTTPException(status_code=400, detail="Query cannot be empty.")

    t0 = time.time()
    intent, confidence = predict_intent(query)
    entities = extract_entities(query)

    if req.use_llm and req.anthropic_key:
        sql = generate_sql_llm_real(query, intent, entities, req.anthropic_key)
    else:
        sql = generate_sql_llm(query, intent, entities)

    valid, err = validate_sql(sql)
    if not valid:
        _history_counter += 1
        query_history.append({"id": _history_counter, "query": query, "sql": sql,
                               "intent": intent, "confidence": confidence,
                               "row_count": 0, "timestamp": _ts(), "success": False})
        raise HTTPException(status_code=400, detail=f"Invalid SQL: {err}")

    try:
        result = execute_query(sql)
    except Exception as e:
        _history_counter += 1
        query_history.append({"id": _history_counter, "query": query, "sql": sql,
                               "intent": intent, "confidence": confidence,
                               "row_count": 0, "timestamp": _ts(), "success": False})
        raise HTTPException(status_code=500, detail=f"SQL error: {str(e)}")

    duration_ms = round((time.time() - t0) * 1000, 1)
    row_count = len(result)
    _history_counter += 1
    query_history.append({"id": _history_counter, "query": query, "sql": sql,
                           "intent": intent, "confidence": confidence,
                           "row_count": row_count, "timestamp": _ts(), "success": True})

    return AskResponse(sql=sql, result=result, intent=intent, confidence=confidence,
                       entities=entities, row_count=row_count, duration_ms=duration_ms)


@app.get("/history", response_model=list[HistoryItem])
def get_history(limit: int = 20):
    return list(reversed(query_history[-limit:]))


@app.delete("/history")
def clear_history():
    query_history.clear()
    return {"ok": True}


@app.get("/schema", response_model=list[SchemaTable])
def get_schema():
    conn = get_connection()
    cur = conn.cursor()
    cur.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
    tables = [r[0] for r in cur.fetchall()]
    result = []
    for t in tables:
        cur.execute(f"PRAGMA table_info({t})")
        cols = [SchemaColumn(name=r[1], type=r[2], pk=bool(r[5]), notnull=bool(r[3]))
                for r in cur.fetchall()]
        cur.execute(f"SELECT COUNT(*) FROM {t}")
        rc = cur.fetchone()[0]
        cur.execute(f"SELECT * FROM {t} LIMIT 3")
        cnames = [d[0] for d in cur.description]
        sample = [dict(zip(cnames, row)) for row in cur.fetchall()]
        result.append(SchemaTable(name=t, columns=cols, row_count=rc, sample=sample))
    conn.close()
    return result


@app.get("/stats")
def get_stats():
    total = len(query_history)
    success = sum(1 for h in query_history if h["success"])
    intents: dict = {}
    for h in query_history:
        intents[h["intent"]] = intents.get(h["intent"], 0) + 1
    avg_conf = round(sum(h["confidence"] for h in query_history) / total, 1) if total else 0
    return {"total_queries": total,
            "success_rate": round(success / total * 100, 1) if total else 0,
            "avg_confidence": avg_conf,
            "intent_breakdown": intents}


@app.get("/health")
def health():
    return {"status": "ok", "model_loaded": clf is not None}


def _ts():
    return datetime.now().isoformat(timespec="seconds")
