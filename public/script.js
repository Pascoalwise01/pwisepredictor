// BacBo Predictor - script corrigido (controle de confirmações e timestamps consistentes)
// Principais mudanças:
// - currentPrediction guarda { choice, probs, time } no momento da geração
// - ConfirmRight adiciona somente REINFORCE_RIGHT cópias (por defeito 1) e bloqueia os botões
// - ConfirmWrong abre manualRealBox; quando for submetido adiciona REINFORCE_WRONG cópias e bloqueia
// - Proteções contra múltiplos cliques e logs usando o timestamp da geração

const SESSION_KEY = "bacbo_hist_session_v1";
const SESSION_STATS = "bacbo_stats_session_v1";
const SESSION_LOG = "bacbo_log_session_v1";

const MAX_HISTORY = 200;
const RECENT_LOOKBACK = 60;
const ORDER = 2;

// Ajustáveis
const REINFORCE_WRONG = 8; // quantas cópias adiciona quando usuário informa real (aprender rápido)
const REINFORCE_RIGHT = 1; // quantas cópias adiciona quando usuário confirma acerto (reforço leve)

const $ = id => document.getElementById(id);
function saveSession(key, value){ try { sessionStorage.setItem(key, JSON.stringify(value)); } catch(e){} }
function loadSession(key, def){ try { const s = sessionStorage.getItem(key); return s ? JSON.parse(s) : def; } catch(e){ return def; } }
function now(){ return new Date().toLocaleTimeString('pt-PT', { hour12:false }); }
function clamp(v,a,b){ return Math.max(a, Math.min(b, v)); }

function norm(token){
  if (!token) return null;
  token = String(token).trim().toUpperCase();
  if (token === "PLAYER" || token === "P") return "P";
  if (token === "BANKER" || token === "B") return "B";
  if (token === "TIE" || token === "T") return "T";
  return null;
}

// state
let history = loadSession(SESSION_KEY, []);
let stats = loadSession(SESSION_STATS, { total:0, right:0, wrong:0 });
let log = loadSession(SESSION_LOG, []);

// current pending prediction (null when none)
let currentPrediction = null; // { choice: "P"/"B"/"T", probs: {P,B,T}, time: "HH:MM:SS" }

// DOM refs
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

// render helpers
function renderGrid(){
  if (!history.length) {
    historyGrid.innerHTML = "<div>Nenhum valor.</div>";
    loadedInfo.innerText = "Histórico vazio (session).";
  } else {
    loadedInfo.innerText = `Últimos ${Math.min(history.length, MAX_HISTORY)} valores (mais recentes à direita).`;
    const last = history.slice(-MAX_HISTORY);
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

function saveLog(entry){
  log.unshift(entry);
  log = log.slice(0,200);
  saveSession(SESSION_LOG, log);
}

// input handlers
loadBtn.addEventListener("click", () => {
  const raw = ta.value.trim();
  if (!raw) return alert("Cole o histórico ou digite valores no campo.");
  const parts = raw.split(/\s+/).map(s => norm(s)).filter(Boolean);
  if (!parts.length) return alert("Não detectei valores válidos (P, B, T).");
  for (const t of parts) history.push(t);
  history = history.slice(-10000);
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
  renderGrid();
  renderStats();
});

// predictor core (same heuristics)
function recencyWeights(n, lambda=0.06){
  const w = new Array(n);
  for (let i=0;i<n;i++) w[i] = Math.exp(-lambda*(n-1-i));
  return w;
}
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
function markovScores(historyArr, order=ORDER){
  const n = historyArr.length;
  if (n < 1) return { P:0,B:0,T:0 };
  const maxK = Math.min(order, n-1);
  const lastSeq = historyArr.slice(-maxK).join("|");
  const scores = { P:0,B:0,T:0 };
  for (let i = 0; i + maxK + 1 < historyArr.length; i++){
    const seq = historyArr.slice(i, i+maxK).join("|");
    const next = historyArr[i+maxK];
    if (seq === lastSeq && next){
      const age = (i + maxK) / historyArr.length;
      const w = Math.exp(-age * 5);
      if (next === "P") scores.P += w;
      if (next === "B") scores.B += w;
      if (next === "T") scores.T += w;
    }
  }
  return scores;
}
function combinedScores(){
  const recent = history.slice(-RECENT_LOOKBACK);
  if (!recent.length) return { P:1,B:1,T:1 };
  const freq = frequencyScores(recent);
  const markov = markovScores(history, ORDER);
  const combined = {
    P: 0.5 * (freq.P || 0) + 0.4 * (markov.P || 0) + 0.1 * 0,
    B: 0.5 * (freq.B || 0) + 0.4 * (markov.B || 0) + 0.1 * 0,
    T: 0.5 * (freq.T || 0) + 0.4 * (markov.T || 0) + 0.1 * 0
  };
  combined.P += 1e-6; combined.B += 1e-6; combined.T += 1e-6;
  return combined;
}
function normalizeScores(scores){
  const s = scores.P + scores.B + scores.T;
  return { P: scores.P/s, B: scores.B/s, T: scores.T/s };
}
function predict(){
  if (!history.length) return null;
  const combined = combinedScores();
  const probs = normalizeScores(combined);
  const entries = Object.entries(probs).sort((a,b) => b[1] - a[1]);
  const choice = entries[0][0];
  return { choice, probs };
}

// UI: generate and manage state
function disableFeedbackButtons(){
  confirmRight.disabled = true;
  confirmWrong.disabled = true;
}
function enableFeedbackButtons(){
  confirmRight.disabled = false;
  confirmWrong.disabled = false;
}

generateBtn.addEventListener("click", () => {
  // if there is a pending prediction, do not override until user confirms or cancels
  if (currentPrediction !== null) {
    // optionally ask user to confirm/clear previous one
    const ok = confirm("Há um palpite pendente. Deseja gerar um novo (o anterior será descartado)?");
    if (!ok) return;
    // discard previous pending (no learning)
    currentPrediction = null;
    predictionBox.classList.add("hidden");
    manualRealBox.classList.add("hidden");
  }

  const p = predict();
  if (!p) return alert("Carrega histórico primeiro.");
  const probP = Math.round(p.probs.P*100);
  const probB = Math.round(p.probs.B*100);
  const probT = Math.round(p.probs.T*100);
  const time = now();

  // set currentPrediction object (used later for logging and consistent time)
  currentPrediction = { choice: p.choice, probs: p.probs, time };

  predictionText.innerHTML = `${time} — Previsão: <strong class="pill ${p.choice}">${p.choice}</strong> | Prob: P ${probP}% • B ${probB}% • T ${probT}%`;
  predictionBox.classList.remove("hidden");
  manualRealBox.classList.add("hidden");
  enableFeedbackButtons();
});

// Confirm right (single reinforcement, idempotent)
confirmRight.addEventListener("click", () => {
  if (!currentPrediction) return alert("Nenhum palpite gerado.");
  // disable feedback to avoid duplicates
  disableFeedbackButtons();

  const pred = currentPrediction.choice;
  // add reinforcement copies (by default REINFORCE_RIGHT=1)
  for (let i=0;i<REINFORCE_RIGHT;i++) history.push(pred);
  history = history.slice(-10000);

  stats.total = (stats.total || 0) + 1;
  stats.right = (stats.right || 0) + 1;

  // log with the generation timestamp for consistency
  saveLog({ hora: currentPrediction.time, palpite: pred, result: "✅ Acertou" });

  // finalize
  saveSession(SESSION_KEY, history);
  saveSession(SESSION_STATS, stats);
  renderGrid(); renderStats();
  currentPrediction = null;
  predictionBox.classList.add("hidden");
  alert("Marcado como acerto — histórico reforçado.");
});

// Confirm wrong (show manual real selection)
confirmWrong.addEventListener("click", () => {
  if (!currentPrediction) return alert("Nenhum palpite gerado.");
  // show manual real buttons
  manualRealBox.classList.remove("hidden");
});

// Real value buttons
document.querySelectorAll(".realBtn").forEach(btn => {
  btn.addEventListener("click", () => {
    if (!currentPrediction) return alert("Nenhum palpite gerado.");
    // disable feedback controls immediately to avoid duplicates
    disableFeedbackButtons();

    const real = btn.dataset.val;
    if (!real) return;

    // add real value many times for strong learning
    for (let i=0;i<REINFORCE_WRONG;i++) history.push(real);
    history = history.slice(-10000);

    stats.total = (stats.total || 0) + 1;
    stats.wrong = (stats.wrong || 0) + 1;

    // log, use stored generation time for consistency
    saveLog({ hora: currentPrediction.time, palpite: currentPrediction.choice, result: `❌ Errou → real ${real}` });

    saveSession(SESSION_KEY, history);
    saveSession(SESSION_STATS, stats);
    renderGrid(); renderStats();
    currentPrediction = null;
    manualRealBox.classList.add("hidden");
    predictionBox.classList.add("hidden");
    alert("Valor real registado e usado para aprendizagem.");
  });
});

// export / import
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
    saveSession(SESSION_KEY, history);
    saveSession(SESSION_STATS, stats);
    saveSession(SESSION_LOG, log);
    renderGrid(); renderStats();
    alert("Importado com sucesso.");
  } catch(e){
    alert("JSON inválido.");
  }
});

// init render
renderGrid();
renderStats();
