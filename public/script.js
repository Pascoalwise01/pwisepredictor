// BacBo Predictor - restaurado + corrigido
// - Histórico em sessionStorage (desaparece ao fechar aba) 
// - Geração manual (Gerar Previsão) 
// - Confirmar Acertou/Errou: apenas uma execução por palpite
// - Erro: adiciona REINFORCE_WRONG cópias do real (aprendizagem agressiva)
// - Acerto: adiciona REINFORCE_RIGHT cópias (reforço leve)
// - Heurísticas: recency-weighted frequency + simple Markov; ajuste conservador para melhorar precisão

const SESSION_KEY = "bacbo_hist_session_v2";
const SESSION_STATS = "bacbo_stats_session_v2";
const SESSION_LOG = "bacbo_log_session_v2";

const MAX_HISTORY = 10000;
const MAX_SHOW = 200;
const RECENT_LOOKBACK = 60;
const ORDER = 2;

// reinforcement (configurável)
const REINFORCE_WRONG = 20; // quando o user informa real (errou)
const REINFORCE_RIGHT = 1;  // quando o user confirma acerto

// target precision (used to adapt conservativeness, not a guarantee)
const TARGET_PRECISION = 0.97;

const $ = id => document.getElementById(id);
function saveSession(k, v){ try { sessionStorage.setItem(k, JSON.stringify(v)); } catch(e){} }
function loadSession(k, def){ try { const s = sessionStorage.getItem(k); return s ? JSON.parse(s) : def; } catch(e){ return def; } }
function now(){ return new Date().toLocaleTimeString('pt-PT', { hour12:false }); }

function normToken(t){
  if (!t) return null;
  t = String(t).trim().toUpperCase();
  if (t === 'P' || t === 'PLAYER') return 'P';
  if (t === 'B' || t === 'BANKER') return 'B';
  if (t === 'T' || t === 'TIE') return 'T';
  return null;
}

// state
let history = loadSession(SESSION_KEY, []);
let stats = loadSession(SESSION_STATS, { total:0, right:0, wrong:0 });
let log = loadSession(SESSION_LOG, []);

let currentPrediction = null; // { choice: 'P'|'B'|'T', probs: {...}, time: 'HH:MM:SS' }

// DOM refs
const ta = $("historyTextarea");
const loadHistoryBtn = $("loadHistoryBtn");
const quickSelect = $("quickSelect");
const addSingleBtn = $("addSingleBtn");
const clearHistoryBtn = $("clearHistoryBtn");
const loadedInfo = $("loadedInfo");

const generateBtn = $("generateBtn");
const predictionBox = $("predictionBox");
const predictionText = $("predictionText");
const confirmRight = $("confirmRight");
const confirmWrong = $("confirmWrong");

const manualRealBox = $("manualRealBox");
const realButtons = () => document.querySelectorAll(".realBtn");

const historyGrid = $("historyGrid");
const stat_total = $("stat_total");
const stat_right = $("stat_right");
const stat_wrong = $("stat_wrong");
const stat_prec = $("stat_prec");
const logArea = $("logArea");

const exportBtn = $("exportBtn");
const importBtn = $("importBtn");

// render helpers
function renderHistoryGrid(){
  if (!history.length) {
    historyGrid.innerHTML = "<div>Sem histórico.</div>";
    loadedInfo.innerText = "Nenhum histórico carregado (session).";
  } else {
    loadedInfo.innerText = `Últimos ${Math.min(history.length, MAX_SHOW)} (mais recentes à direita).`;
    const last = history.slice(-MAX_SHOW);
    historyGrid.innerHTML = last.map(tok => `<div class="pill ${tok}">${tok}</div>`).join("");
  }
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

function appendLog(entry){
  log.unshift(entry);
  log = log.slice(0, 500);
  saveSession(SESSION_LOG, log);
  // render log top-most
  const el = document.createElement('div');
  el.textContent = `[${entry.time}] ${entry.palpite} → ${entry.result}`;
  logArea.prepend(el);
}

// Input handlers
loadHistoryBtn.addEventListener('click', () => {
  const raw = ta.value.trim();
  if (!raw) { alert("Cole valores no campo."); return; }
  const parts = raw.split(/\s+/).map(s => normToken(s)).filter(Boolean);
  if (!parts.length) { alert("Nenhum token válido (P,B,T)."); return; }
  history = history.concat(parts).slice(-MAX_HISTORY);
  ta.value = '';
  renderHistoryGrid();
  alert(`${parts.length} valores adicionados.`);
});

addSingleBtn.addEventListener('click', () => {
  const val = normToken(quickSelect.value);
  if (!val) return;
  history.push(val);
  history = history.slice(-MAX_HISTORY);
  renderHistoryGrid();
});

clearHistoryBtn.addEventListener('click', () => {
  if (!confirm("Limpar histórico da sessão?")) return;
  history = [];
  stats = { total:0, right:0, wrong:0 };
  log = [];
  saveSession(SESSION_KEY, history);
  saveSession(SESSION_STATS, stats);
  saveSession(SESSION_LOG, log);
  renderHistoryGrid(); renderStats();
});

// Predictor heuristics
function recencyWeights(n, lambda=0.06){
  const arr = new Array(n);
  for (let i=0;i<n;i++) arr[i] = Math.exp(-lambda*(n-1-i));
  return arr;
}

function frequencyScores(arr){
  const n = arr.length;
  const weights = recencyWeights(n, 0.06);
  const s = { P:0, B:0, T:0 };
  for (let i=0;i<n;i++){
    const t = arr[i];
    if (!t) continue;
    s[t] += weights[i];
  }
  return s;
}

function markovScores(historyArr, order=ORDER){
  const n = historyArr.length;
  if (n < 2) return { P:0, B:0, T:0 };
  const k = Math.min(order, n-1);
  const lastSeq = historyArr.slice(-k).join('|');
  const scores = { P:0, B:0, T:0 };
  for (let i=0;i + k < historyArr.length; i++){
    const seq = historyArr.slice(i, i+k).join('|');
    const next = historyArr[i+k];
    if (seq === lastSeq && next){
      const age = (i+k) / historyArr.length;
      const w = Math.exp(-age * 5);
      scores[next] += w;
    }
  }
  return scores;
}

// combine heuristics and apply conservativeness adjustment using measured precision
function combinedScores(){
  const recent = history.slice(-RECENT_LOOKBACK);
  if (!recent.length) return { P:1, B:1, T:1 };
  const freq = frequencyScores(recent);
  const markov = markovScores(history, ORDER);

  // measured precision (use stats to adapt behaviour)
  const measured = (stats.total && stats.total > 0) ? ((stats.right || 0) / stats.total) : TARGET_PRECISION;
  const conserv = clamp(1 + (TARGET_PRECISION - measured) * 2.0, 0.5, 3.0);
  // combine with weights, increase weight on frequency if low measured precision
  const wFreq = 0.5 * conserv;
  const wMarkov = 0.4;
  const combined = {
    P: wFreq * (freq.P || 0) + wMarkov * (markov.P || 0) + 1e-6,
    B: wFreq * (freq.B || 0) + wMarkov * (markov.B || 0) + 1e-6,
    T: wFreq * (freq.T || 0) + wMarkov * (markov.T || 0) + 1e-6
  };
  return combined;
}

function normalize(s){
  const sum = s.P + s.B + s.T;
  return { P: s.P/sum, B: s.B/sum, T: s.T/sum };
}

// pick highest-probability choice, tie break by freq
function predict(){
  if (!history.length) return null;
  const comb = combinedScores();
  const probs = normalize(comb);
  const ordered = Object.entries(probs).sort((a,b)=> b[1] - a[1]);
  const choice = ordered[0][0];
  return { choice, probs };
}

// UI helpers: enable/disable
function setFeedbackEnabled(enabled){
  confirmRight.disabled = !enabled;
  confirmWrong.disabled = !enabled;
  realButtons().forEach(b => b.disabled = !enabled);
}

// Generate
generateBtn.addEventListener('click', () => {
  if (currentPrediction !== null) {
    // previous pending: ask user to confirm/cancel before new one
    const ok = confirm("Há um palpite pendente — quer descartá-lo e gerar novo?");
    if (!ok) return;
    // discard previous
    currentPrediction = null;
    predictionBox.classList.add('hidden');
    manualRealBox.classList.add('hidden');
  }

  const p = predict();
  if (!p) { alert("Carrega histórico primeiro."); return; }
  const probs = p.probs;
  const probP = Math.round(probs.P*100);
  const probB = Math.round(probs.B*100);
  const probT = Math.round(probs.T*100);
  const t = now();

  currentPrediction = { choice: p.choice, probs: p.probs, time: t };
  predictionText.innerHTML = `${t} — Previsão: <strong class="pill ${p.choice}">${p.choice}</strong> | P ${probP}% • B ${probB}% • T ${probT}%`;
  predictionBox.classList.remove('hidden');
  manualRealBox.classList.add('hidden');
  setFeedbackEnabled(true);
});

// Acertou (single execution)
confirmRight.addEventListener('click', () => {
  if (!currentPrediction) return alert("Nenhum palpite pendente.");
  // disable feedback to avoid duplicates
  setFeedbackEnabled(false);

  const pred = currentPrediction.choice;
  // add REINFORCE_RIGHT copies
  for (let i=0;i<REINFORCE_RIGHT;i++) history.push(pred);
  history = history.slice(-MAX_HISTORY);

  stats.total = (stats.total || 0) + 1;
  stats.right = (stats.right || 0) + 1;

  appendLog({ time: currentPrediction.time, palpite: pred, result: '✅ Acertou' });

  saveSession(SESSION_KEY, history);
  saveSession(SESSION_STATS, stats);
  renderHistoryGrid(); renderStats();

  // clear pending
  currentPrediction = null;
  predictionBox.classList.add('hidden');
  manualRealBox.classList.add('hidden');
});

// Errou (shows manual real selection; does NOT auto-generate new)
confirmWrong.addEventListener('click', () => {
  if (!currentPrediction) return alert("Nenhum palpite pendente.");
  setFeedbackEnabled(false);
  manualRealBox.classList.remove('hidden');
});

// real buttons
realButtons().forEach(btn => {
  btn.addEventListener('click', () => {
    if (!currentPrediction) return alert("Nenhum palpite pendente.");
    const real = btn.dataset.val;
    if (!real) return;
    // add exactly REINFORCE_WRONG copies of the real value
    const adds = new Array(REINFORCE_WRONG).fill(real);
    history = history.concat(adds).slice(-MAX_HISTORY);

    stats.total = (stats.total || 0) + 1;
    stats.wrong = (stats.wrong || 0) + 1;

    appendLog({ time: currentPrediction.time, palpite: currentPrediction.choice, result: `❌ Errou → real ${real}` });

    saveSession(SESSION_KEY, history);
    saveSession(SESSION_STATS, stats);
    renderHistoryGrid(); renderStats();

    // clear pending and hide boxes; do NOT auto generate
    currentPrediction = null;
    predictionBox.classList.add('hidden');
    manualRealBox.classList.add('hidden');
  });
});

// export / import JSON
exportBtn.addEventListener('click', () => {
  const payload = { history, stats, log };
  const blob = new Blob([JSON.stringify(payload, null,2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = 'bacbo-session.json'; a.click(); URL.revokeObjectURL(url);
});

importBtn.addEventListener('click', () => {
  const txt = prompt("Cole JSON (history / stats / log) para importar:");
  if (!txt) return;
  try {
    const obj = JSON.parse(txt);
    if (Array.isArray(obj.history)) history = obj.history.concat(history).slice(-MAX_HISTORY);
    if (obj.stats) stats = obj.stats;
    if (Array.isArray(obj.log)) log = obj.log.concat(log).slice(0,500);
    saveSession(SESSION_KEY, history);
    saveSession(SESSION_STATS, stats);
    saveSession(SESSION_LOG, log);
    renderHistoryGrid(); renderStats();
    alert("Importado com sucesso.");
  } catch(e){ alert("JSON inválido."); }
});

// init
renderHistoryGrid();
renderStats();
