/* Pascoal Wise Predictor — KDE-based predictor with fast reinforcement
   - Accepts manual history input
   - Generates predictions for azul / lilas / vermelho
   - Red (vermelho) supports arbitrarily large values
   - Uses KDE-like discrete approximation over 0.01 grid and picks density peak (two decimals)
   - Reinforcement: when user provides real value, it is added strongly to history (multiple copies)
   - All persistent data stored in localStorage
*/

/* ---------- CONFIG ---------- */
const STORAGE_VALUES = "pw_values_kde_v1";
const STORAGE_STATS = "pw_stats_kde_v1";
const STORAGE_LOG = "pw_history_log_kde_v1";

const MAX_KEEP = 5000;       // keep many values for better estimation if user supplies
const RECENT_MAX = 1000;
const MIN_VAL = 0.5;
const MAX_VAL = 1000000;     // red can go very high
const STEP = 0.01;           // grid resolution (0.01 for two decimals)
const KDE_BANDWIDTH = 0.08;  // bandwidth in same units (tweakable)
const REINFORCE_COUNT = 8;   // when user provides real value, add it this many times (strong learning)
const REINFORCE_CORRECT = 3; // when user marks correct, add palpite this many times (reinforce)

/* ---------- HELPERS ---------- */
const $ = id => document.getElementById(id);
function saveJSON(k, v){ localStorage.setItem(k, JSON.stringify(v)); }
function loadJSON(k, def){ try { const s = localStorage.getItem(k); return s ? JSON.parse(s) : def; } catch(e){ return def; } }
function clamp(v,a,b){ return Math.max(a, Math.min(b, v)); }
function parseNumRaw(s){ if (s===null || s===undefined) return NaN; s = String(s).trim().replace(/,/g,'.'); s = s.replace(/[^\d.-]/g, ''); const n = parseFloat(s); return isNaN(n)?NaN:n; }
function now(){ return new Date().toLocaleTimeString('pt-PT',{hour12:false}); }
function toTwo(n){ return Number(Number(n).toFixed(2)); }

/* Weighted helpers */
function recencyWeights(n, lambda=0.006) { // small decay for long histories
  const arr = new Array(n);
  for (let i=0;i<n;i++) arr[i] = Math.exp(-lambda*(n-1-i));
  return arr;
}

/* Gaussian kernel for distance d and bandwidth h */
function gaussianKernel(d, h) {
  const z = d / h;
  return Math.exp(-0.5 * z * z) / (Math.sqrt(2*Math.PI) * h);
}

/* ---------- STATE ---------- */
let values = loadJSON(STORAGE_VALUES, []); // numeric array
let stats = loadJSON(STORAGE_STATS, { total:0, right:0, wrong:0 });
let historyLog = loadJSON(STORAGE_LOG, []); // records of predictions
let currentPrediction = null;

/* ---------- DOM refs ---------- */
const ta = $("historyTextarea");
const loadHistoryBtn = $("loadHistoryBtn");
const addSingleBtn = $("addSingleBtn");
const singleValue = $("singleValue");
const clearHistoryBtn = $("clearHistoryBtn");
const loadedInfo = $("loadedInfo");
const generateBtn = $("generateBtn");
const palpiteBox = $("palpiteBox");
const palpiteText = $("palpiteText");
const confirmRight = $("confirmRight");
const confirmWrong = $("confirmWrong");
const manualRealBox = $("manualRealBox");
const realInput = $("realInput");
const submitReal = $("submitReal");
const historyList = $("historyList");
const stat_total = $("stat_total");
const stat_right = $("stat_right");
const stat_wrong = $("stat_wrong");
const stat_prec = $("stat_prec");
const downloadBtn = $("downloadBtn");
const importBtn = $("importBtn");

/* ---------- UI rendering ---------- */
function renderValues(){
  if (!values || values.length === 0) {
    historyList.innerHTML = "<div>Nenhum valor.</div>";
    loadedInfo.innerText = "Nenhum histórico carregado.";
    return;
  }
  loadedInfo.innerText = `Últimos ${Math.min(values.length, 1000)} valores (mais recentes no topo).`;
  historyList.innerHTML = values.slice().reverse().slice(0,500).map(v=>`<div style="padding:6px;border-bottom:1px solid rgba(255,255,255,0.03)">${toTwo(v)}x</div>`).join("");
}
function renderStats(){
  stat_total.innerText = stats.total || 0;
  stat_right.innerText = stats.right || 0;
  stat_wrong.innerText = stats.wrong || 0;
  const p = stats.total ? ((stats.right||0)/stats.total)*100 : 0;
  stat_prec.innerText = `${p.toFixed(1)}%`;
}
function saveAll(){ saveJSON(STORAGE_VALUES, values); saveJSON(STORAGE_STATS, stats); saveJSON(STORAGE_LOG, historyLog); }

/* ---------- Data management ---------- */
loadHistoryBtn.addEventListener("click", () => {
  const raw = ta.value.trim();
  if (!raw) return alert("Cole o histórico (um valor por linha).");
  const lines = raw.split(/\r?\n/).map(s=>s.trim()).filter(s=>s.length>0);
  let added = 0;
  for (let l of lines) {
    const n = parseNumRaw(l);
    if (!isNaN(n) && n >= MIN_VAL && n <= MAX_VAL) { values.push(toTwo(n)); added++; }
  }
  values = values.slice(-MAX_KEEP);
  saveAll();
  renderValues();
  alert(`✅ ${added} valores adicionados.`);
});

addSingleBtn.addEventListener("click", () => {
  const n = parseNumRaw(singleValue.value);
  if (isNaN(n) || n < MIN_VAL || n > MAX_VAL) return alert("Valor inválido.");
  values.push(toTwo(n));
  values = values.slice(-MAX_KEEP);
  singleValue.value = "";
  saveAll();
  renderValues();
});

clearHistoryBtn.addEventListener("click", () => {
  if (!confirm("Limpar histórico local?")) return;
  values = [];
  saveAll();
  renderValues();
});

/* ---------- Predictor core (KDE on discrete grid) ---------- */
/*
 Algorithm summary:
 1) Take recent values (bounded by RECENT_MAX)
 2) Build a small grid around the range of interest (min..max) with resolution STEP
 3) Evaluate KDE on the grid using gaussianKernel with bandwidth KDE_BANDWIDTH
 4) Choose the grid point with maximum density => round to 2 decimals and return
 5) Category selection: based on where the predicted value lies (azul / lilas / vermelho)
*/
function predictKDE() {
  if (!values || values.length < 3) return null;

  const recent = values.slice(-RECENT_MAX);
  const n = recent.length;
  // recency weights (newer more weight)
  const weights = recencyWeights(n, 0.01);

  // compute range for grid. We choose a window covering 0.9*min .. 1.1*max to allow scaling
  let minv = Math.max(MIN_VAL, Math.min(...recent));
  let maxv = Math.max(...recent);
  // expand a bit
  const span = Math.max(0.5, maxv - minv);
  minv = Math.max(MIN_VAL, minv - 0.3 * span);
  maxv = maxv + 0.3 * span;

  // enforce max grid width to avoid heavy computations; if span huge, focus grid near recent quantiles
  const maxGridPoints = 4000; // with STEP 0.01 that is 40 units span; dynamically adapt STEP if needed
  const estPoints = Math.ceil((maxv - minv) / STEP);
  let step = STEP;
  if (estPoints > maxGridPoints) {
    step = (maxv - minv) / maxGridPoints;
  }

  // build grid
  const grid = [];
  for (let x = minv; x <= maxv; x += step) grid.push(x);

  // compute density on grid
  const dens = new Array(grid.length).fill(0);
  const h = Math.max(KDE_BANDWIDTH, step * 1.2); // bandwidth at least step
  for (let i = 0; i < recent.length; i++) {
    const v = recent[i];
    const w = weights[i] || 1;
    // fast evaluation: accumulate on grid by scanning window near v
    // compute index range
    const low = Math.max(0, Math.floor((v - 5*h - minv) / step));
    const high = Math.min(grid.length - 1, Math.ceil((v + 5*h - minv) / step));
    for (let j = low; j <= high; j++) {
      const d = Math.abs(grid[j] - v);
      dens[j] += w * gaussianKernel(d, h);
    }
  }

  // find max density index
  let maxIdx = 0;
  let maxVal = dens[0];
  for (let i = 1; i < dens.length; i++) {
    if (dens[i] > maxVal) {
      maxVal = dens[i];
      maxIdx = i;
    }
  }

  // best grid point
  const best = grid[maxIdx];

  // round to 2 decimals (ensures exact two decimals)
  const pred = toTwo(best);

  // category
  let category = "lilas";
  if (pred < 2) category = "azul";
  else if (pred >= 10) category = "vermelho";
  else category = "lilas";

  return { value: pred, category };
}

/* ---------- Interactions & reinforcement ---------- */
generateBtn.addEventListener("click", () => {
  const p = predictKDE();
  if (!p) return alert("Carrega ou adicione histórico antes de gerar.");
  currentPrediction = p.value;
  palpiteText.innerHTML = `<strong>${now()}</strong> — Palpite: <span style="color:#ffd">${p.value}x</span> (${p.category})`;
  palpiteBox.classList.remove("hidden");
  manualRealBox.classList.add("hidden");
});

confirmRight.addEventListener("click", () => {
  if (currentPrediction === null) return alert("Nenhum palpite gerado.");
  // reinforce predicted value by adding several copies
  for (let i=0;i<REINFORCE_CORRECT;i++) values.push(toTwo(currentPrediction));
  values = values.slice(-MAX_KEEP);
  stats.total = (stats.total || 0) + 1;
  stats.right = (stats.right || 0) + 1;
  historyLog.unshift({hora: now(), palpite: currentPrediction, result: "✅ Acertou"});
  historyLog = historyLog.slice(0, 1000);
  saveAll();
  currentPrediction = null;
  palpiteBox.classList.add("hidden");
  renderValues(); renderStats();
  alert("Marcado como correto e reforçado no histórico.");
});

confirmWrong.addEventListener("click", () => {
  if (currentPrediction === null) return alert("Nenhum palpite gerado.");
  manualRealBox.classList.remove("hidden");
  realInput.value = "";
});

submitReal.addEventListener("click", () => {
  const v = parseNumRaw(realInput.value);
  if (isNaN(v) || v < MIN_VAL || v > MAX_VAL) return alert("Valor real inválido.");
  // add the real value multiple times (strong reinforcement)
  for (let i=0;i<REINFORCE_COUNT;i++) values.push(toTwo(v));
  values = values.slice(-MAX_KEEP);
  stats.total = (stats.total || 0) + 1;
  stats.wrong = (stats.wrong || 0) + 1;
  historyLog.unshift({hora: now(), palpite: currentPrediction, result: `❌ Errou → real ${toTwo(v)}x`});
  historyLog = historyLog.slice(0, 1000);
  saveAll();
  currentPrediction = null;
  manualRealBox.classList.add("hidden");
  palpiteBox.classList.add("hidden");
  renderValues(); renderStats();
  alert("Valor real registado e usado para aprendizagem.");
});

/* Export / import JSON */
downloadBtn.addEventListener("click", () => {
  const payload = { values, stats, historyLog };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = "aviator-data.json"; a.click();
  URL.revokeObjectURL(url);
});
importBtn.addEventListener("click", () => {
  const txt = prompt("Cole JSON para importar (values / stats / historyLog).");
  if (!txt) return;
  try {
    const obj = JSON.parse(txt);
    if (Array.isArray(obj.values)) { values = obj.values.concat(values).slice(-MAX_KEEP); }
    if (obj.stats) { stats = obj.stats; }
    if (Array.isArray(obj.historyLog)) { historyLog = obj.historyLog.concat(historyLog).slice(0,1000); }
    saveAll();
    renderValues(); renderStats();
    alert("Importado com sucesso.");
  } catch(e) {
    alert("JSON inválido.");
  }
});

/* ---------- init ---------- */
renderValues();
renderStats();
