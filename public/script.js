// public/script.js (versão robusta: OCR parsing + edição + preditor ponderado + aprendizado)
// Requer tesseract.js no index.html (CDN ou local) — index.html já tem <script src="...tesseract.min.js">

/* ---------------- CONFIG ---------------- */
const MAX_KEEP = 300;          // quantos valores manter no histórico local
const RECENT_MAX = 100;        // quantas últimas rodadas considerar para pesos
const MIN_VALUE = 1.0;         // menor valor plausível
const MAX_VALUE = 10000.0;     // maior valor plausível
const DEFAULT_PRECISION = 0.97;// meta de precisão (não garante, serve para modelagem)
const STORAGE_KEY = "pw_hist_values_v2";

/* ---------------- HELPERS ---------------- */
function el(id) { return document.getElementById(id); }

function saveValues(arr) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(arr.slice(-MAX_KEEP)));
}

function loadValues() {
  try {
    const s = localStorage.getItem(STORAGE_KEY);
    if (!s) return [];
    const a = JSON.parse(s);
    return Array.isArray(a) ? a : [];
  } catch (e) { return []; }
}

function toNumberRaw(raw) {
  if (typeof raw !== "string") raw = String(raw);
  raw = raw.replace(/\s/g, "");
  raw = raw.replace(/,/g, ".");            // 1,23 -> 1.23
  raw = raw.replace(/x$/i, "");            // remove trailing x
  raw = raw.replace(/[^\d.]/g, "");        // keep digits and dot
  if (!raw) return NaN;
  const n = parseFloat(raw);
  return isFinite(n) ? n : NaN;
}

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

/* Weighted quantile implementation */
function weightedQuantile(values, weights, q) {
  if (!values || values.length === 0) return null;
  const items = values.map((v, i) => ({ v, w: weights[i] || 1 }));
  items.sort((a,b) => a.v - b.v);
  const total = items.reduce((s,x) => s + x.w, 0);
  let cum = 0;
  for (let it of items) {
    cum += it.w;
    if (cum / total >= q) return it.v;
  }
  return items[items.length - 1].v;
}

function recencyWeights(n, lambda = 0.07) {
  // more recent entries have larger weight
  const w = [];
  for (let i = 0; i < n; i++) {
    // i=0 oldest, i=n-1 newest -> weight exp(-lambda*(n-1-i))
    w.push(Math.exp(-lambda * (n - 1 - i)));
  }
  return w;
}

/* ------------ UI helpers ------------- */
const resultadosDiv = el("resultados");
const palpiteDisplay = el("palpiteDisplay") || null; // optional
// We will render parsed values into resultadosDiv

/* ---------------- STATE ---------------- */
let parsedValues = loadValues();     // array of numbers (historic values)
let history = [];                    // palpite history {hora,palpite,resultado,real}
let pendingIndex = null;             // index of last pending in history

/* Render parsed value list with edit/remove */
function renderParsedValues() {
  resultadosDiv.innerHTML = "";
  const container = document.createElement("div");
  container.style.textAlign = "left";
  container.style.padding = "8px";
  container.style.color = "#ffe6ff";

  const title = document.createElement("div");
  title.innerHTML = `<strong>Valores extraídos (últimos ${parsedValues.length}):</strong>`;
  container.appendChild(title);

  const list = document.createElement("ol");
  parsedValues.slice().reverse().forEach((v, idx) => {
    const li = document.createElement("li");
    li.style.margin = "6px 0";
    li.innerHTML = `<span style="display:inline-block;width:110px">${v}x</span>`;
    const btnDel = document.createElement("button");
    btnDel.textContent = "Remover";
    btnDel.style.marginLeft = "8px";
    btnDel.onclick = () => {
      // remove this value from parsedValues (reverse index)
      const realIdx = parsedValues.length - 1 - idx;
      parsedValues.splice(realIdx, 1);
      saveValues(parsedValues);
      renderParsedValues();
    };
    const btnEdit = document.createElement("button");
    btnEdit.textContent = "Editar";
    btnEdit.style.marginLeft = "6px";
    btnEdit.onclick = () => {
      const newVal = prompt("Editar valor (x):", String(v));
      const n = toNumberRaw(newVal);
      if (isFinite(n) && n >= MIN_VALUE && n <= MAX_VALUE) {
        const realIdx = parsedValues.length - 1 - idx;
        parsedValues[realIdx] = Number(n.toFixed(2));
        saveValues(parsedValues);
        renderParsedValues();
      } else alert("Valor inválido");
    };
    li.appendChild(btnEdit);
    li.appendChild(btnDel);
    list.appendChild(li);
  });
  container.appendChild(list);

  // allow manual add
  const addRow = document.createElement("div");
  addRow.style.marginTop = "10px";
  addRow.innerHTML = `Adicionar manual: <input id="pv_add" style="width:120px;padding:6px" placeholder="ex: 3.45" /> `;
  const btnAdd = document.createElement("button");
  btnAdd.textContent = "Adicionar";
  btnAdd.onclick = () => {
    const v = document.getElementById("pv_add").value;
    const n = toNumberRaw(v);
    if (!isFinite(n) || n < MIN_VALUE || n > MAX_VALUE) return alert("Valor inválido");
    parsedValues.push(Number(n.toFixed(2)));
    saveValues(parsedValues);
    renderParsedValues();
    document.getElementById("pv_add").value = "";
  };
  addRow.appendChild(btnAdd);

  // use values button (explicit)
  const useBtn = document.createElement("button");
  useBtn.textContent = "Usar estes valores para gerar palpites";
  useBtn.style.display = "block";
  useBtn.style.marginTop = "12px";
  useBtn.onclick = () => {
    if (parsedValues.length === 0) return alert("Não há valores para usar.");
    alert(`Usando ${parsedValues.length} valores para gerar palpites.`);
  };

  container.appendChild(addRow);
  container.appendChild(useBtn);

  resultadosDiv.appendChild(container);
}

/* ------------- OCR parsing -------------- */
async function processImageFile(file) {
  resultadosDiv.innerHTML = `<div style="color:#ffd">⏳ Iniciando OCR... aguarde</div>`;
  try {
    const worker = Tesseract.createWorker({
      logger: m => {
        if (m.status === "recognizing text") {
          resultadosDiv.innerText = `📖 Lendo texto... ${Math.round(m.progress * 100)}%`;
        }
      }
    });
    await worker.load();
    await worker.loadLanguage('eng');
    await worker.initialize('eng');
    const { data } = await worker.recognize(file);
    await worker.terminate();

    const text = (data && data.text) ? data.text : "";
    resultadosDiv.innerHTML = `<pre style="white-space:pre-wrap;color:#ffd;padding:6px">${escapeHtml(text)}</pre>`;

    // Extract numbers - improved regex: matches things like 1.23, 1,23, 10x, 2x
    const rawMatches = text.match(/(\d{1,4}(?:[.,]\d+)?)(?:\s*[xX])?/g);
    const nums = [];
    if (rawMatches && rawMatches.length) {
      for (let raw of rawMatches) {
        let n = toNumberRaw(raw);
        if (isFinite(n) && n >= MIN_VALUE && n <= MAX_VALUE) {
          nums.push(Number(n.toFixed(2)));
        }
      }
    }

    // de-duplicate adjacent duplicates (OCR often repeats same number many times)
    const filtered = [];
    for (let v of nums) {
      if (filtered.length === 0 || Math.abs(filtered[filtered.length - 1] - v) > 0.001) filtered.push(v);
    }

    if (filtered.length === 0) {
      resultadosDiv.innerHTML += `\n\n⚠️ Nenhum número plausível detectado. Podes editar manualmente abaixo.`;
      parsedValues = parsedValues || [];
    } else {
      // merge with existing parsedValues (append new)
      parsedValues = parsedValues.concat(filtered).slice(-MAX_KEEP);
      saveValues(parsedValues);
      resultadosDiv.innerHTML += `\n\n✅ ${filtered.length} valores lidos e adicionados ao histórico local.`;
    }

    renderParsedValues();
  } catch (err) {
    console.error("OCR error:", err);
    resultadosDiv.innerHTML = `❌ Erro no OCR: ${err.message || err}`;
  }
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
}

/* -------------- Prediction logic ------------- */
// classify
function classify(v) {
  if (v >= 10) return "vermelho";
  if (v >= 2) return "lilas";
  return "azul";
}

function generatePrediction() {
  if (!parsedValues || parsedValues.length === 0) {
    alert("Sem histórico carregado. Carrega a imagem ou adiciona valores manualmente.");
    return null;
  }

  // consider last RECENT_MAX values
  const recent = parsedValues.slice(-RECENT_MAX);
  const n = recent.length;
  const weights = recencyWeights(n, 0.08);

  // accumulate weights per category
  let sumAzul=0, sumLilas=0, sumVerm=0;
  const valsAzul = [], valsLilas = [], valsVerm = [];
  for (let i=0;i<n;i++) {
    const v = recent[i];
    const w = weights[i] || 1;
    if (v < 2) { sumAzul += w; valsAzul.push({v,w}); }
    else if (v < 10) { sumLilas += w; valsLilas.push({v,w}); }
    else { sumVerm += w; valsVerm.push({v,w}); }
  }

  // choose category by relative weight (with small smoothing)
  let chosen = 'lilas';
  if (sumVerm > sumLilas * 1.05 && sumVerm > sumAzul) chosen = 'vermelho';
  else if (sumAzul > sumLilas * 1.05 && sumAzul > sumVerm) chosen = 'azul';
  else chosen = 'lilas';

  // choose quantile depending on category
  function getWeightedQ(arr, q) {
    if (!arr.length) return null;
    const vals = arr.map(x=>x.v);
    const ws = arr.map(x=>x.w);
    return weightedQuantile(vals, ws, q);
  }

  let base = null;
  if (chosen === 'vermelho') {
    base = getWeightedQ(valsVerm, 0.8) || Math.max(...recent);
  } else if (chosen === 'lilas') {
    base = getWeightedQ(valsLilas, 0.6) || weightedQuantile(recent, weights, 0.6);
  } else {
    base = getWeightedQ(valsAzul, 0.5) || weightedQuantile(recent, weights, 0.4);
  }

  if (!base || !isFinite(base)) base = weightedQuantile(recent, weights, 0.6) || 2.5;

  // small jitter/probabilistic error to avoid 100% deterministic
  const jitter = (Math.random()*2 - 1) * 0.02; // ±2%
  const predicted = clamp(base * (1 + jitter), MIN_VALUE, MAX_VALUE);

  return { value: Number(predicted.toFixed(2)), category: chosen };
}

/* ------------- History & UI --------------- */
function pushHistoryEntry(entry) {
  history.unshift(entry);
  if (history.length > 200) history.pop();
  renderHistory();
}

function renderHistory() {
  // find table or create inside resultadosDiv
  let t = document.getElementById("pw_hist_table");
  if (!t) {
    t = document.createElement("table");
    t.id = "pw_hist_table";
    t.style.width = "100%";
    t.style.marginTop = "12px";
    t.innerHTML = `<thead><tr><th>#</th><th>Hora</th><th>Palpite</th><th>Resultado</th></tr></thead><tbody></tbody>`;
    resultadosDiv.appendChild(t);
  }
  const tbody = t.querySelector("tbody");
  tbody.innerHTML = "";
  history.forEach((h, i) => {
    const row = document.createElement("tr");
    row.style.borderTop = "1px solid rgba(255,255,255,0.04)";
    row.innerHTML = `<td>${i+1}</td><td>${h.hora}</td><td>${h.palpite}x (${h.category})</td><td>${h.resultado || "Pendente"}</td>`;
    tbody.appendChild(row);
  });
}

/* --------------- Learning --------------- */
// when user provides real value (after error), add to parsedValues and save
function handleUserRealValue(real) {
  const n = Number(real);
  if (!isFinite(n) || n < MIN_VALUE || n > MAX_VALUE) {
    alert("Valor inválido");
    return;
  }
  parsedValues.push(Number(n.toFixed(2)));
  if (parsedValues.length > MAX_KEEP) parsedValues = parsedValues.slice(-MAX_KEEP);
  saveValues(parsedValues);
  renderParsedValues();
  // update last pending history entry
  const pend = history.find(h => h.resultado === "Pendente");
  if (pend) {
    pend.resultado = `Errou → real ${n}x`;
    pend.real = n;
    renderHistory();
  }
}

/* ---------------- DOM bindings ---------------- */
(function bind() {
  // upload input + button (index.html must have file input and button wired)
  const fileInput = document.querySelector('#imageInput');
  const uploadBtn = document.querySelector('#uploadBtn');
  const generateBtn = document.querySelector('#generateBtn');
  const acertouBtn = document.querySelector('#acertouBtn');
  const errouBtn = document.querySelector('#errouBtn');

  if (uploadBtn && fileInput) {
    uploadBtn.addEventListener('click', () => {
      const f = fileInput.files[0];
      if (!f) return alert('Selecione uma imagem primeiro');
      processImageFile(f);
    });
  }

  if (generateBtn) {
    generateBtn.addEventListener('click', () => {
      if (!parsedValues || parsedValues.length === 0) {
        return alert('Carrega um histórico primeiro (ou adicione valores manualmente).');
      }
      const pred = generatePrediction();
      if (!pred) return alert('Não foi possível gerar palpite.');
      const hora = new Date().toLocaleTimeString('pt-PT', { hour12:false });
      pushHistoryEntry({ hora, palpite: pred.value, category: pred.category, resultado: 'Pendente' });
      // show in top area if exists
      const display = el('palpiteDisplay');
      if (display) display.innerHTML = `<strong>🕒 ${hora}</strong> — Palpite: <span style="color:#ffd">${pred.value}x</span> (${pred.category})`;
      else {
        // fallback: append small notice
        resultadosDiv.insertAdjacentHTML('afterbegin', `<div style="color:#ffd;margin-bottom:8px">🕒 ${hora} — Palpite: ${pred.value}x (${pred.category})</div>`);
      }
    });
  }

  if (acertouBtn) {
    acertouBtn.addEventListener('click', () => {
      const pend = history.find(h => h.resultado === "Pendente");
      if (!pend) return alert('Nenhum palpite pendente para marcar.');
      pend.resultado = "✅ Acertou";
      // optional: reinforce by adding same value to parsedValues (slightly)
      parsedValues.push(Number(pend.palpite.toFixed ? pend.palpite : Number(pend.palpite)));
      saveValues(parsedValues);
      renderHistory();
      renderParsedValues();
    });
  }

  if (errouBtn) {
    errouBtn.addEventListener('click', () => {
      // show prompt to input real value
      const val = prompt('Insira o valor real (onde o avião parou), ex: 2.35');
      if (val === null) return;
      const n = toNumberRaw(val);
      if (!isFinite(n)) return alert('Valor inválido.');
      handleUserRealValue(n);
    });
  }

  // initial render
  renderParsedValues();
  renderHistory();
})();

/* --------------- end ---------------- */
