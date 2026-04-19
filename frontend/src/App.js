import React, { useState, useRef, useEffect, useCallback } from 'react';

// ── Constants ─────────────────────────────────────────────────────────────────
const API = '';

const INTENT_META = {
  SUM:      { color: '#00d4aa', icon: '∑' },
  AVG:      { color: '#7c6ef7', icon: 'x̄' },
  COUNT:    { color: '#f7a16e', icon: '#' },
  FILTER:   { color: '#f76e6e', icon: '⊃' },
  GROUP_BY: { color: '#6eb5f7', icon: '⊞' },
  TOP_N:    { color: '#f7e16e', icon: '↑' },
  JOIN:     { color: '#a8f76e', icon: '⋈' },
};

const SUGGESTIONS = [
  'show customer names with their order amounts',
  'top 5 customers by total spending',
  'total revenue from orders',
  'orders where amount is greater than 500',
  'total orders grouped by country',
  'average order amount',
  'customers from USA',
  'count all orders',
];

// ── Utilities ─────────────────────────────────────────────────────────────────
function fv(v) {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'number') return v % 1 !== 0 ? v.toFixed(2) : v.toLocaleString();
  return String(v);
}

function timeAgo(iso) {
  const diff = Math.floor((Date.now() - new Date(iso)) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  return `${Math.floor(diff / 3600)}h ago`;
}

// ── SQL Highlighter ───────────────────────────────────────────────────────────
const KW_COLOR = '#7c6ef7';
const STR_COLOR = '#f7a16e';
const NUM_COLOR = '#00d4aa';

function SQLHighlight({ sql }) {
  if (!sql) return null;
  const keywords = ['SELECT','FROM','WHERE','INNER','JOIN','ON','GROUP BY','ORDER BY',
    'LIMIT','LEFT','SUM','AVG','COUNT','AS','AND','OR','BY','DESC','ASC','HAVING'];
  const tokens = [];
  let rest = sql;
  while (rest.length > 0) {
    // string literal
    if (rest[0] === "'") {
      const end = rest.indexOf("'", 1);
      const str = end === -1 ? rest : rest.slice(0, end + 1);
      tokens.push(<span key={tokens.length} style={{ color: STR_COLOR }}>{str}</span>);
      rest = end === -1 ? '' : rest.slice(end + 1);
      continue;
    }
    // number
    const numM = rest.match(/^\d+(\.\d+)?/);
    if (numM) {
      tokens.push(<span key={tokens.length} style={{ color: NUM_COLOR }}>{numM[0]}</span>);
      rest = rest.slice(numM[0].length);
      continue;
    }
    // keyword (case-insensitive)
    const kwMatch = keywords
      .map(kw => ({ kw, m: rest.match(new RegExp(`^${kw}\\b`, 'i')) }))
      .find(x => x.m);
    if (kwMatch) {
      tokens.push(<span key={tokens.length} style={{ color: KW_COLOR, fontWeight: 600 }}>{kwMatch.m[0]}</span>);
      rest = rest.slice(kwMatch.m[0].length);
      continue;
    }
    // plain char
    tokens.push(rest[0]);
    rest = rest.slice(1);
  }
  return <>{tokens}</>;
}

// ── Result Table ──────────────────────────────────────────────────────────────
function ResultTable({ data }) {
  if (!data || data.length === 0) return (
    <p style={{ color: '#555', fontFamily: 'JetBrains Mono', fontSize: 12, margin: '8px 0 0' }}>
      No rows returned.
    </p>
  );
  const cols = Object.keys(data[0]);
  return (
    <div style={{ overflowX: 'auto', marginTop: 10, borderRadius: 8, border: '1px solid #ffffff0d' }}>
      <table style={{ borderCollapse: 'collapse', width: '100%', fontFamily: 'JetBrains Mono', fontSize: 12 }}>
        <thead>
          <tr>{cols.map(c => (
            <th key={c} style={{
              textAlign: 'left', padding: '7px 12px',
              background: '#0f0f1e', color: '#7c6ef7',
              borderBottom: '1px solid #7c6ef722', whiteSpace: 'nowrap',
              fontWeight: 600, letterSpacing: '0.06em',
            }}>{c}</th>
          ))}</tr>
        </thead>
        <tbody>
          {data.map((row, i) => (
            <tr key={i} style={{ background: i % 2 === 0 ? '#0a0a14' : '#0d0d1a' }}>
              {cols.map(c => (
                <td key={c} style={{
                  padding: '6px 12px', color: '#c8c8e0',
                  borderBottom: '1px solid #ffffff06',
                }}>{fv(row[c])}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Intent Badge ──────────────────────────────────────────────────────────────
function IntentBadge({ intent, confidence }) {
  const meta = INTENT_META[intent] || { color: '#888', icon: '?' };
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5,
      background: meta.color + '18', color: meta.color,
      border: `1px solid ${meta.color}33`,
      fontFamily: 'JetBrains Mono', fontSize: 10, fontWeight: 700,
      padding: '3px 9px', borderRadius: 20, letterSpacing: '0.08em',
    }}>
      <span style={{ fontSize: 12 }}>{meta.icon}</span>
      {intent}
      {confidence != null && (
        <span style={{ opacity: 0.6, fontWeight: 400 }}>{confidence}%</span>
      )}
    </span>
  );
}

// ── Chat Message ──────────────────────────────────────────────────────────────
function Message({ msg, onRerun }) {
  const [sqlOpen, setSqlOpen] = useState(true);

  if (msg.role === 'user') return (
    <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 18 }}>
      <div style={{
        background: 'linear-gradient(135deg, #7c6ef7dd, #00d4aadd)',
        color: '#020210', padding: '11px 17px',
        borderRadius: '18px 18px 4px 18px',
        fontFamily: 'Syne', fontWeight: 700, fontSize: 14, maxWidth: '72%',
      }}>{msg.text}</div>
    </div>
  );

  if (msg.loading) return (
    <div style={{ marginBottom: 20 }}>
      <div style={{
        display: 'inline-flex', alignItems: 'center', gap: 6,
        background: '#12121f', border: '1px solid #ffffff0a',
        borderRadius: '4px 18px 18px 18px', padding: '14px 18px',
      }}>
        {[0, 1, 2].map(i => (
          <div key={i} style={{
            width: 7, height: 7, borderRadius: '50%', background: '#7c6ef7',
            animation: `pulse 1.1s ${i * 0.18}s ease-in-out infinite`,
          }} />
        ))}
      </div>
    </div>
  );

  if (msg.error) return (
    <div style={{ marginBottom: 18 }}>
      <div style={{
        background: '#1e0a0a', border: '1px solid #f76e6e33',
        borderRadius: '4px 18px 18px 18px', padding: '13px 17px',
        color: '#f76e6e', fontFamily: 'JetBrains Mono', fontSize: 12,
      }}>⚠ {msg.error}</div>
    </div>
  );

  return (
    <div style={{ marginBottom: 22 }}>
      <div style={{
        background: '#10101e', border: '1px solid #ffffff0a',
        borderRadius: '4px 18px 18px 18px', padding: '16px 18px', maxWidth: '94%',
      }}>
        {/* Meta row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
          {msg.intent && <IntentBadge intent={msg.intent} confidence={msg.confidence} />}
          {msg.duration_ms != null && (
            <span style={{ color: '#444', fontFamily: 'JetBrains Mono', fontSize: 10 }}>
              {msg.duration_ms}ms
            </span>
          )}
          {msg.row_count != null && (
            <span style={{ color: '#444', fontFamily: 'JetBrains Mono', fontSize: 10 }}>
              {msg.row_count} row{msg.row_count !== 1 ? 's' : ''}
            </span>
          )}
          {onRerun && (
            <button onClick={onRerun} style={{
              marginLeft: 'auto', background: 'none', border: '1px solid #ffffff18',
              borderRadius: 8, color: '#666', fontFamily: 'JetBrains Mono',
              fontSize: 10, padding: '2px 8px', cursor: 'pointer',
            }}>↺ rerun</button>
          )}
        </div>

        {/* SQL toggle */}
        {msg.sql && (
          <div style={{ marginBottom: 10 }}>
            <button
              onClick={() => setSqlOpen(o => !o)}
              style={{
                background: 'none', border: 'none', cursor: 'pointer',
                color: '#00d4aa88', fontFamily: 'JetBrains Mono',
                fontSize: 10, letterSpacing: '0.1em', padding: 0, marginBottom: sqlOpen ? 6 : 0,
              }}
            >
              {sqlOpen ? '▾' : '▸'} SQL GENERATED
            </button>
            {sqlOpen && (
              <div style={{
                background: '#080812', border: '1px solid #00d4aa18',
                borderRadius: 8, padding: '10px 14px',
                fontFamily: 'JetBrains Mono', fontSize: 12,
                lineHeight: 1.7, wordBreak: 'break-all',
              }}>
                <SQLHighlight sql={msg.sql} />
              </div>
            )}
          </div>
        )}

        {/* Results */}
        {msg.result && <ResultTable data={msg.result} />}
      </div>
    </div>
  );
}

// ── Schema Panel ──────────────────────────────────────────────────────────────
function SchemaPanel({ schema }) {
  const [expanded, setExpanded] = useState({});
  if (!schema) return <div style={{ color: '#555', fontSize: 13 }}>Loading schema…</div>;

  return (
    <div>
      {schema.map(table => (
        <div key={table.name} style={{ marginBottom: 14 }}>
          <button
            onClick={() => setExpanded(e => ({ ...e, [table.name]: !e[table.name] }))}
            style={{
              width: '100%', background: '#12121f', border: '1px solid #ffffff0f',
              borderRadius: 8, padding: '8px 12px', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              color: '#d4d4f0', fontFamily: 'JetBrains Mono', fontSize: 12,
            }}
          >
            <span>
              <span style={{ color: '#7c6ef7', fontWeight: 600 }}>{table.name}</span>
              <span style={{ color: '#555', marginLeft: 8 }}>{table.row_count} rows</span>
            </span>
            <span style={{ color: '#444' }}>{expanded[table.name] ? '▴' : '▾'}</span>
          </button>
          {expanded[table.name] && (
            <div style={{
              background: '#0a0a14', border: '1px solid #ffffff08',
              borderRadius: '0 0 8px 8px', borderTop: 'none', padding: '10px 12px',
            }}>
              {table.columns.map(col => (
                <div key={col.name} style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  padding: '3px 0', borderBottom: '1px solid #ffffff05',
                }}>
                  <span style={{ color: '#c8c8e0', fontFamily: 'JetBrains Mono', fontSize: 11, minWidth: 100 }}>
                    {col.name}
                  </span>
                  <span style={{ color: '#555', fontFamily: 'JetBrains Mono', fontSize: 10 }}>
                    {col.type}
                  </span>
                  {col.pk && (
                    <span style={{
                      background: '#f7e16e18', color: '#f7e16e',
                      border: '1px solid #f7e16e33', fontSize: 9, padding: '1px 5px',
                      borderRadius: 4, fontFamily: 'JetBrains Mono',
                    }}>PK</span>
                  )}
                  {col.notnull && !col.pk && (
                    <span style={{
                      background: '#f76e6e18', color: '#f76e6e',
                      border: '1px solid #f76e6e33', fontSize: 9, padding: '1px 5px',
                      borderRadius: 4, fontFamily: 'JetBrains Mono',
                    }}>NOT NULL</span>
                  )}
                </div>
              ))}
              {table.sample.length > 0 && (
                <div style={{ marginTop: 8 }}>
                  <div style={{ color: '#444', fontFamily: 'JetBrains Mono', fontSize: 9,
                    letterSpacing: '0.1em', marginBottom: 4 }}>SAMPLE</div>
                  <ResultTable data={table.sample} />
                </div>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ── History Panel ─────────────────────────────────────────────────────────────
function HistoryPanel({ history, onSelect, onClear }) {
  if (!history || history.length === 0) return (
    <div style={{ color: '#555', fontSize: 12, fontFamily: 'JetBrains Mono' }}>
      No queries yet.
    </div>
  );
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 10 }}>
        <button onClick={onClear} style={{
          background: 'none', border: '1px solid #f76e6e33', borderRadius: 6,
          color: '#f76e6e88', fontFamily: 'JetBrains Mono', fontSize: 10,
          padding: '3px 10px', cursor: 'pointer',
        }}>clear history</button>
      </div>
      {history.map(h => (
        <div key={h.id}
          onClick={() => onSelect(h.query)}
          style={{
            background: '#12121f', border: '1px solid #ffffff08',
            borderRadius: 8, padding: '9px 12px', marginBottom: 8,
            cursor: 'pointer', transition: 'border-color 0.15s',
          }}
          onMouseEnter={e => e.currentTarget.style.borderColor = '#7c6ef733'}
          onMouseLeave={e => e.currentTarget.style.borderColor = '#ffffff08'}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
            <IntentBadge intent={h.intent} confidence={null} />
            <span style={{
              marginLeft: 'auto', color: h.success ? '#00d4aa66' : '#f76e6e66',
              fontFamily: 'JetBrains Mono', fontSize: 9,
            }}>{h.success ? '✓' : '✗'} {timeAgo(h.timestamp)}</span>
          </div>
          <div style={{ color: '#c8c8e0', fontSize: 12, fontFamily: 'Syne', marginBottom: 3 }}>
            {h.query}
          </div>
          <div style={{ color: '#444', fontFamily: 'JetBrains Mono', fontSize: 10, 
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {h.sql}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Stats Panel ───────────────────────────────────────────────────────────────
function StatsPanel({ stats }) {
  if (!stats) return <div style={{ color: '#555', fontSize: 12 }}>No stats yet.</div>;
  const intentEntries = Object.entries(stats.intent_breakdown || {})
    .sort((a, b) => b[1] - a[1]);
  const maxCount = Math.max(...intentEntries.map(e => e[1]), 1);
  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 16 }}>
        {[
          { label: 'Total Queries', value: stats.total_queries },
          { label: 'Success Rate', value: `${stats.success_rate}%` },
          { label: 'Avg Confidence', value: `${stats.avg_confidence}%` },
          { label: 'Intent Types', value: intentEntries.length },
        ].map(({ label, value }) => (
          <div key={label} style={{
            background: '#12121f', border: '1px solid #ffffff08',
            borderRadius: 8, padding: '10px 12px',
          }}>
            <div style={{ color: '#555', fontFamily: 'JetBrains Mono', fontSize: 9,
              letterSpacing: '0.1em', marginBottom: 4 }}>{label.toUpperCase()}</div>
            <div style={{ color: '#d4d4f0', fontFamily: 'JetBrains Mono',
              fontSize: 18, fontWeight: 700 }}>{value}</div>
          </div>
        ))}
      </div>
      {intentEntries.length > 0 && (
        <div>
          <div style={{ color: '#444', fontFamily: 'JetBrains Mono', fontSize: 9,
            letterSpacing: '0.1em', marginBottom: 8 }}>INTENT BREAKDOWN</div>
          {intentEntries.map(([intent, count]) => {
            const meta = INTENT_META[intent] || { color: '#888', icon: '?' };
            return (
              <div key={intent} style={{ marginBottom: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between',
                  marginBottom: 3, fontFamily: 'JetBrains Mono', fontSize: 11 }}>
                  <span style={{ color: meta.color }}>{meta.icon} {intent}</span>
                  <span style={{ color: '#555' }}>{count}</span>
                </div>
                <div style={{ background: '#0a0a14', borderRadius: 3, height: 4 }}>
                  <div style={{
                    background: meta.color, borderRadius: 3, height: '100%',
                    width: `${(count / maxCount) * 100}%`,
                    transition: 'width 0.4s ease',
                  }} />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Settings Panel ────────────────────────────────────────────────────────────
function SettingsPanel({ apiKey, setApiKey, useLlm, setUseLlm }) {
  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <div style={{ color: '#7c6ef7', fontFamily: 'JetBrains Mono', fontSize: 10,
          letterSpacing: '0.1em', marginBottom: 8 }}>LLM MODE</div>
        <button
          onClick={() => setUseLlm(v => !v)}
          style={{
            width: '100%', padding: '10px 12px', borderRadius: 8, cursor: 'pointer',
            border: `1px solid ${useLlm ? '#7c6ef755' : '#ffffff18'}`,
            background: useLlm ? '#7c6ef718' : '#12121f',
            color: useLlm ? '#7c6ef7' : '#888',
            fontFamily: 'JetBrains Mono', fontSize: 12, textAlign: 'left',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          }}
        >
          <span>Use Claude (real LLM)</span>
          <span style={{ fontSize: 16 }}>{useLlm ? '●' : '○'}</span>
        </button>
        <div style={{ color: '#444', fontFamily: 'JetBrains Mono', fontSize: 10,
          marginTop: 6, lineHeight: 1.5 }}>
          {useLlm
            ? 'Will call Anthropic API with your key below.'
            : 'Rule-based fallback (no API key needed).'}
        </div>
      </div>

      {useLlm && (
        <div>
          <div style={{ color: '#7c6ef7', fontFamily: 'JetBrains Mono', fontSize: 10,
            letterSpacing: '0.1em', marginBottom: 8 }}>ANTHROPIC API KEY</div>
          <input
            type="password"
            value={apiKey}
            onChange={e => setApiKey(e.target.value)}
            placeholder="sk-ant-..."
            style={{
              width: '100%', background: '#0a0a14', border: '1px solid #ffffff18',
              borderRadius: 8, padding: '9px 12px', color: '#d4d4f0',
              fontFamily: 'JetBrains Mono', fontSize: 12,
              outline: 'none', boxSizing: 'border-box',
            }}
          />
          <div style={{ color: '#444', fontFamily: 'JetBrains Mono', fontSize: 10,
            marginTop: 6 }}>
            Key is sent to your local backend only — never stored.
          </div>
        </div>
      )}

      <div style={{ marginTop: 20, padding: '12px', background: '#0a0a14',
        border: '1px solid #ffffff08', borderRadius: 8 }}>
        <div style={{ color: '#444', fontFamily: 'JetBrains Mono', fontSize: 9,
          letterSpacing: '0.1em', marginBottom: 8 }}>PIPELINE</div>
        {['preprocess', 'TF-IDF vectorize', 'LogReg → intent', 'entity extract',
          'build prompt', 'LLM / fallback', 'validate SQL', 'execute SQLite'].map((step, i) => (
          <div key={step} style={{ display: 'flex', alignItems: 'center', gap: 8,
            padding: '4px 0', borderBottom: '1px solid #ffffff05' }}>
            <span style={{ color: '#7c6ef766', fontFamily: 'JetBrains Mono', fontSize: 9,
              minWidth: 14 }}>{i + 1}</span>
            <span style={{ color: '#888', fontFamily: 'JetBrains Mono', fontSize: 11 }}>{step}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Sidebar ───────────────────────────────────────────────────────────────────
const TABS = ['Schema', 'History', 'Stats', 'Settings'];

function Sidebar({ activeTab, setActiveTab, schema, history, stats, onSelectQuery,
  onClearHistory, apiKey, setApiKey, useLlm, setUseLlm }) {
  return (
    <div style={{
      width: 300, minWidth: 300, background: '#0c0c1a',
      borderLeft: '1px solid #ffffff08', display: 'flex', flexDirection: 'column',
      overflow: 'hidden',
    }}>
      {/* Tab bar */}
      <div style={{ display: 'flex', borderBottom: '1px solid #ffffff08' }}>
        {TABS.map(tab => (
          <button key={tab} onClick={() => setActiveTab(tab)} style={{
            flex: 1, padding: '11px 0', background: 'none',
            border: 'none', cursor: 'pointer', fontFamily: 'JetBrains Mono',
            fontSize: 10, letterSpacing: '0.05em',
            color: activeTab === tab ? '#7c6ef7' : '#444',
            borderBottom: `2px solid ${activeTab === tab ? '#7c6ef7' : 'transparent'}`,
            transition: 'all 0.15s',
          }}>{tab}</button>
        ))}
      </div>

      {/* Tab content */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 14 }}>
        {activeTab === 'Schema' && <SchemaPanel schema={schema} />}
        {activeTab === 'History' && (
          <HistoryPanel history={history} onSelect={onSelectQuery} onClear={onClearHistory} />
        )}
        {activeTab === 'Stats' && <StatsPanel stats={stats} />}
        {activeTab === 'Settings' && (
          <SettingsPanel apiKey={apiKey} setApiKey={setApiKey}
            useLlm={useLlm} setUseLlm={setUseLlm} />
        )}
      </div>
    </div>
  );
}

// ── Main App ──────────────────────────────────────────────────────────────────
export default function App() {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [sidebarTab, setSidebarTab] = useState('Schema');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [schema, setSchema] = useState(null);
  const [history, setHistory] = useState([]);
  const [stats, setStats] = useState(null);
  const [useLlm, setUseLlm] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const bottomRef = useRef(null);
  const inputRef = useRef(null);

  const fetchSidebar = useCallback(async () => {
    try {
      const [sc, hi, st] = await Promise.all([
        fetch(`${API}/schema`).then(r => r.json()),
        fetch(`${API}/history`).then(r => r.json()),
        fetch(`${API}/stats`).then(r => r.json()),
      ]);
      setSchema(sc);
      setHistory(hi);
      setStats(st);
    } catch (e) {
      // backend not running
    }
  }, []);

  useEffect(() => { fetchSidebar(); }, [fetchSidebar]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  async function submit(queryText) {
    const query = (queryText || input).trim();
    if (!query || loading) return;
    setInput('');
    setMessages(m => [...m, { role: 'user', text: query },
      { role: 'assistant', loading: true, id: Date.now() }]);
    setLoading(true);

    try {
      const res = await fetch(`${API}/ask`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, use_llm: useLlm, anthropic_key: apiKey }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Request failed');

      setMessages(m => {
        const copy = [...m];
        copy[copy.length - 1] = {
          role: 'assistant', sql: data.sql, result: data.result,
          intent: data.intent, confidence: data.confidence,
          entities: data.entities, row_count: data.row_count,
          duration_ms: data.duration_ms, query,
        };
        return copy;
      });
      fetchSidebar();
    } catch (e) {
      setMessages(m => {
        const copy = [...m];
        copy[copy.length - 1] = { role: 'assistant', error: e.message };
        return copy;
      });
    } finally {
      setLoading(false);
      setTimeout(() => inputRef.current?.focus(), 60);
    }
  }

  async function clearHistory() {
    await fetch(`${API}/history`, { method: 'DELETE' });
    fetchSidebar();
  }

  return (
    <div style={{
      height: '100vh', display: 'flex', flexDirection: 'column',
      background: '#080812', fontFamily: 'Syne, sans-serif', overflow: 'hidden',
    }}>
      {/* Header */}
      <header style={{
        padding: '14px 20px', borderBottom: '1px solid #ffffff08',
        display: 'flex', alignItems: 'center', gap: 14, flexShrink: 0,
        background: '#080812',
      }}>
        <div style={{
          width: 32, height: 32, borderRadius: 9,
          background: 'linear-gradient(135deg, #7c6ef7, #00d4aa)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 16, fontWeight: 800, color: '#020210',
        }}>⚡</div>
        <div>
          <div style={{ fontSize: 17, fontWeight: 800, color: '#fff', letterSpacing: '-0.02em' }}>
            AskQL{' '}
            <span style={{
              fontSize: 10, fontFamily: 'JetBrains Mono', fontWeight: 700,
              background: 'linear-gradient(90deg, #7c6ef7, #00d4aa)',
              WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
            }}>3.0</span>
          </div>
          <div style={{ fontSize: 10, color: '#444', fontFamily: 'JetBrains Mono', letterSpacing: '0.07em' }}>
            NL → ML → LLM → SQL
          </div>
        </div>

        {/* LLM mode pill */}
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
          {useLlm && (
            <span style={{
              background: '#7c6ef718', color: '#7c6ef7',
              border: '1px solid #7c6ef733', fontFamily: 'JetBrains Mono',
              fontSize: 10, padding: '3px 10px', borderRadius: 20,
            }}>claude-sonnet</span>
          )}
          <button
            onClick={() => setSidebarOpen(o => !o)}
            style={{
              background: sidebarOpen ? '#7c6ef718' : '#12121f',
              border: `1px solid ${sidebarOpen ? '#7c6ef733' : '#ffffff18'}`,
              borderRadius: 8, padding: '6px 10px', cursor: 'pointer',
              color: sidebarOpen ? '#7c6ef7' : '#666',
              fontFamily: 'JetBrains Mono', fontSize: 11,
            }}
          >
            {sidebarOpen ? '⊟ panel' : '⊞ panel'}
          </button>
        </div>
      </header>

      {/* Body */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {/* Chat */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {/* Messages */}
          <div style={{
            flex: 1, overflowY: 'auto', padding: '24px 28px',
          }}>
            {/* Welcome */}
            {messages.length === 0 && (
              <div style={{ textAlign: 'center', paddingTop: 40, marginBottom: 40 }}>
                <div style={{
                  fontSize: 36, fontWeight: 800, color: '#fff',
                  letterSpacing: '-0.03em', lineHeight: 1.1, marginBottom: 10,
                }}>
                  Ask your database<br />
                  <span style={{
                    background: 'linear-gradient(90deg, #7c6ef7, #00d4aa)',
                    WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
                  }}>in plain English</span>
                </div>
                <div style={{ color: '#555', fontFamily: 'JetBrains Mono', fontSize: 12, marginBottom: 28 }}>
                  TF-IDF + LogReg → entity extract → prompt → SQL → execute
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7, justifyContent: 'center' }}>
                  {SUGGESTIONS.map((s, i) => (
                    <button key={i} onClick={() => submit(s)} style={{
                      background: '#12121f', border: '1px solid #ffffff12',
                      borderRadius: 18, padding: '6px 13px', color: '#888',
                      fontFamily: 'JetBrains Mono', fontSize: 11, cursor: 'pointer',
                      transition: 'all 0.15s',
                    }}
                      onMouseEnter={e => { e.target.style.borderColor = '#7c6ef755'; e.target.style.color = '#d4d4f0'; }}
                      onMouseLeave={e => { e.target.style.borderColor = '#ffffff12'; e.target.style.color = '#888'; }}
                    >{s}</button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((msg, i) => (
              <Message
                key={i} msg={msg}
                onRerun={msg.query && !msg.loading ? () => submit(msg.query) : null}
              />
            ))}
            <div ref={bottomRef} />
          </div>

          {/* Input */}
          <div style={{
            padding: '14px 20px', borderTop: '1px solid #ffffff08',
            background: '#080812', flexShrink: 0,
          }}>
            <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end' }}>
              <textarea
                ref={inputRef}
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); }}}
                placeholder="Ask anything about your data…"
                rows={1}
                style={{
                  flex: 1, background: '#12121f', border: '1px solid #ffffff18',
                  borderRadius: 12, padding: '12px 16px', color: '#fff',
                  fontFamily: 'Syne', fontSize: 14, resize: 'none', outline: 'none',
                  boxSizing: 'border-box', lineHeight: 1.5, transition: 'border-color 0.15s',
                }}
                onFocus={e => e.target.style.borderColor = '#7c6ef766'}
                onBlur={e => e.target.style.borderColor = '#ffffff18'}
              />
              <button
                onClick={() => submit()}
                disabled={loading || !input.trim()}
                style={{
                  background: loading || !input.trim()
                    ? '#12121f'
                    : 'linear-gradient(135deg, #7c6ef7, #00d4aa)',
                  border: 'none', borderRadius: 12, padding: '12px 18px',
                  cursor: loading || !input.trim() ? 'not-allowed' : 'pointer',
                  color: loading || !input.trim() ? '#333' : '#020210',
                  fontWeight: 800, fontSize: 18, transition: 'all 0.15s',
                  minWidth: 48, display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}
              >↑</button>
            </div>
            <div style={{ color: '#2a2a3a', fontFamily: 'JetBrains Mono', fontSize: 10,
              textAlign: 'center', marginTop: 6 }}>
              Enter to send · Shift+Enter for new line
            </div>
          </div>
        </div>

        {/* Sidebar */}
        {sidebarOpen && (
          <Sidebar
            activeTab={sidebarTab} setActiveTab={setSidebarTab}
            schema={schema} history={history} stats={stats}
            onSelectQuery={q => { setInput(q); inputRef.current?.focus(); }}
            onClearHistory={clearHistory}
            apiKey={apiKey} setApiKey={setApiKey}
            useLlm={useLlm} setUseLlm={setUseLlm}
          />
        )}
      </div>

      <style>{`
        * { box-sizing: border-box; }
        body { margin: 0; background: #080812; }
        ::-webkit-scrollbar { width: 5px; height: 5px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: #1e1e32; border-radius: 3px; }
        @keyframes pulse {
          0%, 100% { opacity: 0.25; transform: scale(0.75); }
          50% { opacity: 1; transform: scale(1); }
        }
      `}</style>
    </div>
  );
}
