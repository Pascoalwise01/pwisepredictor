const SESSION_KEY = "bacbo_history";
const SESSION_STATS = "bacbo_stats";
const REINFORCE_RIGHT = 1;
const REINFORCE_WRONG = 20;

let history = loadSession(SESSION_KEY) || [];
let stats = loadSession(SESSION_STATS) || { total: 0, right: 0, wrong: 0 };
let currentPrediction = null;

// DOM elements
const generateBtn = document.getElementById("generateBtn");
const predictionBox = document.getElementById("predictionBox");
const predictionText = document.getElementById("predictionText");
const confirmRight = document.getElementById("confirmRight");
const confirmWrong = document.getElementById("confirmWrong");
const manualRealBox = document.getElementById("manualRealBox");
const historyContainer = document.getElementById("historyContainer");
const statsBox = document.getElementById("statsBox");

// Funções utilitárias
function loadSession(key) {
  try { return JSON.parse(localStorage.getItem(key)) || []; } catch { return []; }
}
function saveSession(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}
function saveLog(entry) {
  const logArea = document.getElementById("logArea");
  const item = document.createElement("div");
  item.textContent = `[${entry.hora}] ${entry.palpite} → ${entry.result}`;
  logArea.prepend(item);
}

function renderGrid() {
  historyContainer.innerHTML = "";
  history.slice(-30).forEach((val) => {
    const el = document.createElement("div");
    el.className = "history-item";
    el.textContent = val;
    el.style.color =
      val === "PLAYER" ? "#1ee0ff" :
      val === "BANKER" ? "#ff007c" :
      "#ffea00";
    historyContainer.appendChild(el);
  });
}

function renderStats() {
  const acc = stats.total > 0 ? ((stats.right / stats.total) * 100).toFixed(1) : 0;
  statsBox.textContent = `🎯 ${acc}% de precisão (${stats.right}/${stats.total})`;
}

function disableFeedbackButtons() {
  confirmRight.disabled = true;
  confirmWrong.disabled = true;
  document.querySelectorAll(".realBtn").forEach(btn => btn.disabled = true);
}

function enableFeedbackButtons() {
  confirmRight.disabled = false;
  confirmWrong.disabled = false;
  document.querySelectorAll(".realBtn").forEach(btn => btn.disabled = false);
}

// Algoritmo simples de previsão
function generatePrediction() {
  const now = new Date().toLocaleTimeString();
  let options = ["PLAYER", "BANKER", "TIE"];

  // Baseado no histórico: reforço de frequência
  let weighted = [];
  history.forEach(h => {
    for (let i = 0; i < 2; i++) weighted.push(h);
  });
  options.forEach(opt => weighted.push(opt));

  const choice = weighted[Math.floor(Math.random() * weighted.length)];
  return { time: now, choice };
}

// Clique para gerar novo palpite
generateBtn.addEventListener("click", () => {
  currentPrediction = generatePrediction();
  predictionBox.classList.remove("hidden");
  manualRealBox.classList.add("hidden");
  predictionText.textContent = `🎯 Próximo provável: ${currentPrediction.choice}`;
  enableFeedbackButtons();
});

// Confirmação de acerto
confirmRight.addEventListener("click", () => {
  if (!currentPrediction) return alert("Nenhum palpite gerado.");
  disableFeedbackButtons();

  const pred = currentPrediction.choice;
  for (let i = 0; i < REINFORCE_RIGHT; i++) history.push(pred);
  history = history.slice(-10000);

  stats.total = (stats.total || 0) + 1;
  stats.right = (stats.right || 0) + 1;

  saveLog({ hora: currentPrediction.time, palpite: pred, result: "✅ Acertou" });

  saveSession(SESSION_KEY, history);
  saveSession(SESSION_STATS, stats);
  renderGrid(); renderStats();

  currentPrediction = null;
  predictionBox.classList.add("hidden");
  manualRealBox.classList.add("hidden");

  setTimeout(() => generateBtn.click(), 400);
});

// Quando erra
confirmWrong.addEventListener("click", () => {
  if (!currentPrediction) return alert("Nenhum palpite gerado.");
  disableFeedbackButtons();

  manualRealBox.classList.remove("hidden");
});

// Clique nas opções reais (PLAYER/BANKER/TIE)
document.querySelectorAll(".realBtn").forEach(btn => {
  btn.addEventListener("click", () => {
    if (!currentPrediction) return alert("Nenhum palpite gerado.");
    disableFeedbackButtons();

    const real = btn.dataset.val;
    if (!real) return;

    const adds = Array(REINFORCE_WRONG).fill(real);
    history = history.concat(adds).slice(-10000);

    stats.total = (stats.total || 0) + 1;
    stats.wrong = (stats.wrong || 0) + 1;

    saveLog({
      hora: currentPrediction.time,
      palpite: currentPrediction.choice,
      result: `❌ Errou → real ${real}`
    });

    saveSession(SESSION_KEY, history);
    saveSession(SESSION_STATS, stats);
    renderGrid(); renderStats();

    currentPrediction = null;
    manualRealBox.classList.add("hidden");
    predictionBox.classList.add("hidden");

    setTimeout(() => generateBtn.click(), 400);
  });
});

// Inicialização
renderGrid();
renderStats();
