/* Pascoal Wise Predictor - manual history, high-precision predictor
   - User inputs history manually (textarea or single add)
   - Predictor uses recency-weighted quantiles to output a conservative palpite
   - User marks Acertou or Errou; errors with real value are added to history (learning)
   - Stats saved in localStorage
*/

// -------- CONFIG ----------
const STORAGE_KEY_VALUES = "pw_values_v3";
const STORAGE_KEY_STATS = "pw_stats_v3";
const MAX_KEEP = 1000;
const RECENT_MAX = 200;
const MIN_VAL = 1.0;
const MAX_VAL = 10000.0;
const TARGET_PRECISION = 0.97; // desired behavior (algorithm uses heuristics to aim here)

// -------- HELPERS ----------
const $ = id => document.getElementById(id);
function clamp(v, a, b){ return Math.max(a, Math.min(b, v)); }
function saveJSON(key, obj){ localStorage.setItem(key, JSON.stringify(obj)); }
function loadJSON(key, def){ try { const s = localStorage.getItem(key); return s ? JSON.parse(s) : def; } catch(e){ return def; } }

// weighted quantile
function weightedQuantile(values, weights, q){
  if (!values || values.length === 0) return null;
  const items = values.map((v,i)=>({v, w:weights[i]||1}));
  items.sort((a,b)=> a.v - b.v);
  const total = items.reduce((s,x)=>s+x.w,0);
  let cum = 0;
  for (let it of items){
    cum += it.w;
    if (cum/total >= q) return it.v;
  }
  return items[items.length-1].v;
}
function recencyWeights(n, lambda=0.08){
  const arr=[];
  for (let i=0;i<n;i++){
    arr.push(Math.exp(-lambda*(n-1-i)));
  }
  return arr;
}

// normalise input string to number
function parseNumberRaw(s){
  if (s === null || s === undefined) return NaN;
  s = String(s).trim();
  if (!s) return NaN;
  s = s.replace(/,/g, '.').replace(/[^\d.]/g,'');
  const v = parseFloat(s);
  return isNaN(v) ? NaN : v;
}

// -------- STATE ----------
let values = loadJSON(STORAGE_KEY_VALUES, []); // numeric array
let stats = loadJSON(STORAGE_KEY_STATS, { total:0, right:0, wrong:0 });
renderAll();

// -------- DOM refs ----------
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

const histList = $("historyList");
const stat_total = $("stat_total");
const stat_right = $("stat_right");
const stat_wrong = $("stat_wrong");
const stat_prec = $("stat_prec");

let currentPrediction = null; // { value, category, hora }
let historyLog = loadJSON("pw_history_log_v3", []);

// -------- UI actions ----------
loadHistoryBtn.addEventListener("click", () => {
  const raw = ta.value.trim();
  if (!raw) return alert("Cole ou digite valores no campo de histórico.");
  const lines = raw.split(/\r?\n/).map(r=>r.trim()).filter(r=>r.length>0);
  let added = 0;
  for (let l of lines){
    const n = parseNumberRaw(l);
    if (!isNaN(n) && n >= MIN_VAL && n <= MAX_VAL){
      values.push(Number(n.toFixed(2)));
      added++;
    }
  }
  values = values.slice(-MAX_KEEP);
  saveJSON(STORAGE_KEY_VALUES, values);
  renderAll();
  alert(`✅ ${added} valores adicionados ao histórico.`);
});

addSingleBtn.addEventListener("click", () => {
  const n = parseNumberRaw(singleValue.value);
  if (isNaN(n) || n < MIN_VAL || n > MAX_VAL) return alert("Valor inválido.");
  values.push(Number(n.toFixed(2)));
  values = values.slice(-MAX_KEEP);
  saveJSON(STORAGE_KEY_VALUES, values);
  singleValue.value = "";
  renderAll();
});

clearHistoryBtn.addEventListener("click", () => {
  if (!confirm("Limpar todo o histórico local?")) return;
  values = [];
  saveJSON(STORAGE_KEY_VALUES, values);
  renderAll();
});

generateBtn.addEventListener("click", () => {
  if (!values || values.length === 0) return alert("Carrega o histórico primeiro.");
  const pred = generatePrediction();
  if (!pred) return alert("Não foi possível gerar palpite.");
  const hora = new Date().toLocaleTimeString('pt-PT', { hour12:false });
  currentPrediction = { hora, value: pred.value, category: pred.category };
  palpiteText.innerHTML = `<strong>${hora}</strong> — Palpite: <span style="color:#ffd">${pred.value}x</span> (${pred.category})`;
  palpiteBox.classList.remove("hidden");
  manualRealBox.classList.add("hidden");
  // append pending to historyLog
  historyLog.unshift({ hora, palpite: pred.value, category: pred.category, result: "Pendente" });
  historyLog = historyLog.slice(0, 500);
  saveJSON("pw_history_log_v3", historyLog);
  renderHistoryLog();
  // stats: increment generated count
  stats.total = (stats.total || 0) + 1;
  saveJSON(STORAGE_KEY_STATS, stats);
  renderStats();
});

// Confirm Right
confirmRight.addEventListener("click", () => {
  if (!currentPrediction) return alert("Nenhum palpite pendente.");
  // mark last pending
  const p = historyLog.find(h => h.result === "Pendente");
  if (p) p.result = "✅ Acertou";
  // reinforce: add slightly the palpite value to values to increase weight
  values.push(Number(currentPrediction.value));
  if (values.length > MAX_KEEP) values = values.slice(-MAX_KEEP);
  saveJSON(STORAGE_KEY_VALUES, values);
  stats.right = (stats.right || 0) + 1;
  saveJSON(STORAGE_KEY_STATS, stats);
  renderAll();
  alert("✅ Marcado como acerto. Obrigado!");
  currentPrediction = null;
  palpiteBox.classList.add("hidden");
});

// Confirm Wrong -> show input
confirmWrong.addEventListener("click", () => {
  if (!currentPrediction) return alert("Nenhum palpite pendente.");
  manualRealBox.classList.remove("hidden");
  realInput.value = "";
});

submitReal.addEventListener("click", () => {
  const n = parseNumberRaw(realInput.value);
  if (isNaN(n) || n < MIN_VAL || n > MAX_VAL) return alert("Valor real inválido.");
  // update last pending
  const p = historyLog.find(h => h.result === "Pendente");
  if (p) p.result = `❌ Errou → real ${Number(n.toFixed(2))}x`;
  // learning: add real to values (stronger reinforcement)
  values.push(Number(n.toFixed(2)));
  // capacity
  if (values.length > MAX_KEEP) values = values.slice(-MAX_KEEP);
  saveJSON(STORAGE_KEY_VALUES, values);
  stats.wrong = (stats.wrong || 0) + 1;
  saveJSON(STORAGE_KEY_STATS, stats);
  renderAll();
  alert("🔧 Valor real registrado. Obrigado!");
  manualRealBox.classList.add("hidden");
  palpiteBox.classList.add("hidden");
  currentPrediction = null;
});

// Export / Import JSON
$("downloadBtn").addEventListener("click", () => {
  const data = { values, stats, historyLog };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'aviator-data.json';
  a.click();
  URL.revokeObjectURL(url);
});

$("importBtn").addEventListener("click", () => {
  const text = prompt("Cole aqui o JSON para importar (values e/ou stats).");
  if (!text) return;
  try {
    const obj = JSON.parse(text);
    if (Array.isArray(obj.values)) { values = obj.values.concat(values).slice(-MAX_KEEP); saveJSON(STORAGE_KEY_VALUES, values); }
    if (obj.stats) { stats = obj.stats; saveJSON(STORAGE_KEY_STATS, stats); }
    if (Array.isArray(obj.historyLog)) { historyLog = obj.historyLog.concat(historyLog).slice(0,500); saveJSON("pw_history_log_v3", historyLog); }
    renderAll();
    alert("✅ Importado.");
  } catch (e) {
    alert("JSON inválido.");
  }
});

// -------- Predictor core ----------
function generatePrediction(){
  // use last RECENT_MAX values
  const recent = values.slice(-RECENT_MAX);
  if (!recent.length) return null;
  const n = recent.length;
  const weights = recencyWeights(n, 0.08);

  // split categories
  let valsAzul = [], valsLilas = [], valsVerm = [];
  let sumAz=0,sumLi=0,sumVe=0;
  for (let i=0;i<n;i++){
    const v = recent[i];
    const w = weights[i] || 1;
    if (v < 2) { sumAz += w; valsAzul.push({v,w}); }
    else if (v < 10) { sumLi += w; valsLilas.push({v,w}); }
    else { sumVe += w; valsVerm.push({v,w}); }
  }

  // pick category by weight with smoothing
  let chosen = 'lilas';
  if (sumVe > sumLi * 1.05 && sumVe > sumAz) chosen = 'vermelho';
  else if (sumAz > sumLi * 1.05 && sumAz > sumVe) chosen = 'azul';
  else chosen = 'lilas';

  // compute base using weighted quantile appropriate for category
  function wqFromArr(arr, q){ if (!arr.length) return null; return weightedQuantile(arr.map(x=>x.v), arr.map(x=>x.w), q); }
  let base = null;
  if (chosen === 'vermelho') base = wqFromArr(valsVerm, 0.75) || Math.max(...recent);
  else if (chosen === 'lilas') base = wqFromArr(valsLilas, 0.6) || weightedQuantile(recent, weights, 0.6);
  else base = wqFromArr(valsAzul, 0.5) || weightedQuantile(recent, weights, 0.45);

  if (!base || !isFinite(base)) base = weightedQuantile(recent, weights, 0.6) || 2.5;

  // adapt conservativeness based on current measured precision: if our precision measured is below target, be more conservative
  const measuredPrec = (stats.total && stats.total>0) ? ( (stats.right||0) / stats.total ) : TARGET_PRECISION;
  // if measuredPrec < target -> reduce variance (narrow around a higher quantile) to increase safe predictions
  const safetyFactor = clamp(1 + (TARGET_PRECISION - measuredPrec) * 2.5, 0.5, 3); // >1 -> be more conservative
  // compute jitter magnitude small
  const jitterPct = 0.02 / safetyFactor; // smaller jitter if less precise we want to be conservative

  const jitter = (Math.random()*2 - 1) * jitterPct;
  const predicted = clamp(base * (1 + jitter), MIN_VAL, MAX_VAL);

  return { value: Number(predicted.toFixed(2)), category: chosen };
}

// -------- Render helpers ----------
function renderAll(){
  renderValues();
  renderHistoryLog();
  renderStats();
  renderCurrentInfo();
}
function renderValues(){
  if (!values || values.length === 0) {
    histList.innerText = "Nenhum valor.";
    loadedInfo.innerText = "Nenhum histórico carregado.";
    return;
  }
  loadedInfo.innerText = `Últimos ${Math.min(values.length, 200)} valores (mais recentes no topo).`;
  histList.innerHTML = values.slice().reverse().map(v=>`<div>${v}x</div>`).join("");
}
function renderHistoryLog(){
  const tbody = historyLog.slice(0,50); // show latest 50
  const html = tbody.map((h,i)=>`<div style="padding:6px;border-bottom:1px solid rgba(255,255,255,0.03)">${i+1}. ${h.hora} — ${h.palpite}x (${h.category}) — ${h.result}</div>`).join("");
  const node = $("historyList");
  node.innerHTML = html || "<div>Nenhum palpite gerado ainda.</div>";
}
function renderStats(){
  stat_total.innerText = stats.total || 0;
  stat_right.innerText = stats.right || 0;
  stat_wrong.innerText = stats.wrong || 0;
  const p = (stats.total && stats.total>0) ? ((stats.right||0)/stats.total)*100 : 0;
  stat_prec.innerText = `${p.toFixed(1)}%`;
}
function renderCurrentInfo(){
  // placeholder
}

// initial render
renderAll();
