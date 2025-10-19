// BacBo Predictor - lightweight predictor that learns from user feedback
// Data stored in sessionStorage (cleared when user closes the tab)
// IDs expected: historyTextarea, loadHistoryBtn, quickSelect, addSingleBtn, clearHistoryBtn,
// loadedInfo, generateBtn, predictionBox, predictionText, confirmRight, confirmWrong,
// manualRealBox, realBtn (class), stat_* fields, historyGrid, exportBtn, importBtn.

// ---------- CONFIG ----------
const SESSION_KEY = "bacbo_hist_session_v1";    // sessionStorage for values
const SESSION_STATS = "bacbo_stats_session_v1"; // sessionStorage for stats
const SESSION_LOG = "bacbo_log_session_v1";     // sessionStorage for history log

const MAX_HISTORY = 200;   // show last 200 in grid
const RECENT_LOOKBACK = 60; // how many recent rounds to weigh
const ORDER = 2; // Markov order used for simple sequence modeling
const REINFORCE_WRONG = 8; // how many times to add real value when wrong (fast learning)
const REINFORCE_RIGHT = 3; // how many times to add palpite when correct (reinforce)

// ---------- HELPERS ----------
const $ = id => document.getElementById(id);
function saveSession(key, value){ sessionStorage.setItem(key, JSON.stringify(value)); }
function loadSession(key, def){ try { const s = sessionStorage.getItem(key); return s ? JSON.parse(s) : def; } catch(e){ return def; } }
function now(){ return new Date().toLocaleTimeString('pt-PT', { hour12:false }); }
function clamp(v,a,b){ return Math.max(a, Math.min(b, v)); }

// normalise input (P, B, T)
function norm(token){
  if (!token) return null;
  token = String(token).trim().toUpperCase();
  if (token === "PLAYER" || token === "P") return "P";
  if (token === "BANKER" || token === "B") return "B";
  if (token === "TIE" || token === "T") return "T";
  return null;
}

// ---------- STATE ----------
let history = loadSession(SESSION_KEY, []); // array of tokens "P","B","T" newest last
let stats = loadSession(SESSION_STATS, { total:0, right:0, wrong:0 });
let log = loadSession(SESSION_LOG, []);

// ---------- DOM refs ----------
const ta = $("historyTextarea");
const loadBtn = $("loadHistoryBtn");
const quickSelect = $("quickSelect");
const addSingleBtn = $("addSingleBtn");
const clearBtn = $("clearHistoryBtn");
const loadedInfo = $("loadedInfo");

const generateBtn = $("generateBtn");
const predictionBox = $("predictionBox");
const predictionText = $("predictionText");
const confirmRight = $("confirmRight");
const confirmWrong = $("confirmWrong");

const manualRealBox = $("manualRealBox");

const historyGrid = $("historyGrid");
const stat_total = $("stat_total");
const stat_right = $("stat_right");
const stat_wrong = $("stat_wrong");
const stat_prec = $("stat_prec");

const exportBtn = $("exportBtn");
const importBtn = $("importBtn");

// ---------- RENDER ----------
function renderGrid(){
  if (!history.length) { historyGrid.innerHTML = "<div>Nenhum valor.</div>"; loadedInfo.innerText = "Histórico vazio (session)."; return; }
  loadedInfo.innerText = `Últimos ${Math.min(history.length, MAX_HISTORY)} valores (mais recentes à direita).`;
  const last = history.slice(-MAX_HISTORY);
  historyGrid.innerHTML = last.map(tok => `<div class="pill ${tok}">${tok}</div>`).join("");
  saveSession(SESSION_KEY, history);
}

function renderStats(){
  stat_total.innerText = stats.total || 0;
  stat_right.innerText = stats.right || 0;
  stat_wrong.innerText = stats.wrong || 0;
  const p = stats.total ? ((stats.right||0)/stats.total)*100 : 0;
  stat_prec.innerText = `${p.toFixed(1)}%`;
  saveSession(SESSION_STATS, stats);
}

function saveLog(entry){
  log.unshift(entry);
  log = log.slice(0,200);
  saveSession(SESSION_LOG, log);
}

// ---------- INPUT HANDLERS ----------
loadBtn.addEventListener("click", () => {
  const raw = ta.value.trim();
  if (!raw) return alert("Cole o histórico ou digite valores no campo.");
  // suportar linhas ou espaços
  const parts = raw.split(/\s+/).map(s => norm(s)).filter(Boolean);
  if (!parts.length) return alert("Não detectei valores válidos (P, B, T).");
  for (const t of parts) history.push(t);
  history = history.slice(-10000); // cap excessively
  ta.value = "";
  renderGrid();
  alert(`${parts.length} valores adicionados ao histórico (session).`);
});

addSingleBtn.addEventListener("click", () => {
  const val = norm(quickSelect.value);
  if (!val) return;
  history.push(val);
  history = history.slice(-10000);
  renderGrid();
});

clearBtn.addEventListener("click", () => {
  if (!confirm("Limpar histórico (session)?")) return;
  history = [];
  stats = { total:0, right:0, wrong:0 };
  log = [];
  saveSession(SESSION_KEY, history);
  saveSession(SESSION_STATS, stats);
  saveSession(SESSION_LOG, log);
  renderGrid(); renderStats();
});

// ---------- PREDICTOR CORE ----------
// Weighted recency: newer items get higher weight
function recencyWeights(n, lambda=0.06){
  const w = new Array(n);
  for (let i=0;i<n;i++) w[i] = Math.exp(-lambda*(n-1-i));
  return w;
}

// Frequency baseline (counts weighted recent)
function frequencyScores(recent){
  const n = recent.length;
  const weights = recencyWeights(n, 0.06);
  const score = { P:0, B:0, T:0 };
  for (let i=0;i<n;i++){
    const t = recent[i];
    if (!t) continue;
    score[t] += weights[i];
  }
  return score;
}

// Markov (order 1..ORDER) transitions counting with recency weights
function markovScores(historyArr, order=ORDER){
  // build conditional counts for next token given previous sequence
  // We'll compute score for next token by looking at last k tokens and counting matches
  const n = historyArr.length;
  if (n < 1) return { P:0,B:0,T:0 };

  const maxK = Math.min(order, n-1);
  const lastSeq = historyArr.slice(-maxK).join("|");
  const scores = { P:0,B:0,T:0 };

  // iterate over sliding windows
  for (let i = 0; i + maxK + 1 < historyArr.length; i++){
    const seq = historyArr.slice(i, i+maxK).join("|");
    const next = historyArr[i+maxK];
    if (seq === lastSeq && next){
      // weight by recency of this occurrence
      const age = (i + maxK) / historyArr.length;
      const w = Math.exp(-age * 5); // older occ less weight
      if (next === "P") scores.P += w;
      if (next === "B") scores.B += w;
      if (next === "T") scores.T += w;
    }
  }
  return scores;
}

// combine heuristics into final probability-like scores
function combinedScores(){
  const recent = history.slice(-RECENT_LOOKBACK);
  if (!recent.length) return { P:1,B:1,T:1 }; // neutral if empty

  const freq = frequencyScores(recent);
  const markov = markovScores(history, ORDER);

  // Combine with weights: freq (0.5), markov (0.4), small bias for ties (0.1)
  const combined = {
    P: 0.5 * (freq.P || 0) + 0.4 * (markov.P || 0) + 0.1 * 0,
    B: 0.5 * (freq.B || 0) + 0.4 * (markov.B || 0) + 0.1 * 0,
    T: 0.5 * (freq.T || 0) + 0.4 * (markov.T || 0) + 0.1 * 0
  };

  // small smoothing to avoid zeros
  combined.P += 1e-6;
  combined.B += 1e-6;
  combined.T += 1e-6;
  return combined;
}

// normalize to probabilities
function normalizeScores(scores){
  const s = scores.P + scores.B + scores.T;
  return { P: scores.P/s, B: scores.B/s, T: scores.T/s };
}

// select highest probability as prediction (tie-breaker: frequency)
function predict(){
  if (!history.length) return null;
  const combined = combinedScores();
  const probs = normalizeScores(combined);
  // pick highest
  const entries = Object.entries(probs).sort((a,b) => b[1] - a[1]);
  const choice = entries[0][0];
  return { choice, probs };
}

// ---------- UI - generation and learning ----------
generateBtn.addEventListener("click", () => {
  const p = predict();
  if (!p) return alert("Carrega histórico primeiro.");
  const probP = Math.round(p.probs.P*100);
  const probB = Math.round(p.probs.B*100);
  const probT = Math.round(p.probs.T*100);
  predictionText.innerHTML = `${now()} — Previsão: <strong class="pill ${p.choice}">${p.choice}</strong> | Prob: P ${probP}% • B ${probB}% • T ${probT}%`;
  predictionBox.classList.remove("hidden");
  manualRealBox.classList.add("hidden");
});

// When user confirms the prediction was correct
confirmRight.addEventListener("click", () => {
  // extract predicted token from UI
  const match = predictionText.innerText.match(/\b(P|B|T)\b/);
  if (!match) return alert("Nenhum palpite presente.");
  const pred = match[1];
  // reinforce predicted token
  for (let i=0;i<REINFORCE_RIGHT;i++) history.push(pred);
  history = history.slice(-10000);
  stats.total = (stats.total || 0) + 1;
  stats.right = (stats.right || 0) + 1;
  saveSession();
  renderGrid(); renderStats();
  saveLog({ hora: now(), palpite: pred, result: "✅ Acertou" });
  predictionBox.classList.add("hidden");
  alert("Marcado como acerto — histórico reforçado.");
});

// When user says it was wrong -> show manualRealBox to choose real result
confirmWrong.addEventListener("click", () => {
  manualRealBox.classList.remove("hidden");
});

// When user chooses the real result after a wrong prediction
document.querySelectorAll(".realBtn").forEach(btn => {
  btn.addEventListener("click", () => {
    const real = btn.dataset.val;
    if (!real) return;
    // add the real value multiple times to learn quickly
    for (let i=0;i<REINFORCE_WRONG;i++) history.push(real);
    history = history.slice(-10000);
    stats.total = (stats.total || 0) + 1;
    stats.wrong = (stats.wrong || 0) + 1;
    saveSession();
    renderGrid(); renderStats();
    saveLog({ hora: now(), palpite: "X", result: `❌ Errou → real ${real}` });
    manualRealBox.classList.add("hidden");
    predictionBox.classList.add("hidden");
    alert("Valor real registado e usado para aprendizagem.");
  });
});

// ---------- Session save/load ----------
function saveSession(){
  saveSessionData(SESSION_KEY, history);
  saveSessionData(SESSION_STATS, stats);
  saveSessionData(SESSION_LOG, log);
}
function saveSessionData(key, obj){ try { sessionStorage.setItem(key, JSON.stringify(obj)); } catch(e){ console.warn("sessionStorage error", e); } }

// Export / Import
exportBtn.addEventListener("click", () => {
  const payload = { history, stats, log };
  const blob = new Blob([JSON.stringify(payload, null,2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href = url; a.download = "bacbo-session.json"; a.click(); URL.revokeObjectURL(url);
});

importBtn.addEventListener("click", () => {
  const txt = prompt("Cole o JSON (history / stats / log) para importar:");
  if (!txt) return;
  try {
    const obj = JSON.parse(txt);
    if (Array.isArray(obj.history)) { history = obj.history.concat(history).slice(-10000); }
    if (obj.stats) stats = obj.stats;
    if (Array.isArray(obj.log)) log = obj.log.concat(log).slice(0,200);
    saveSessionData(SESSION_KEY, history);
    saveSessionData(SESSION_STATS, stats);
    saveSessionData(SESSION_LOG, log);
    renderGrid(); renderStats();
    alert("Importado com sucesso.");
  } catch(e){
    alert("JSON inválido.");
  }
});

// ---------- init ----------
renderGrid();
renderStats();

// Note: we use sessionStorage so when the user closes the tab the history is cleared (you asked that it may disappear).
// If you want persistence between sessions, switch to localStorage load/save functions.
