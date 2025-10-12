// script.js - fluxo simples: upload (uma vez) -> gerar palpite -> usuário confirma / corrige
const uploadBtn = document.getElementById('uploadBtn');
const imageInput = document.getElementById('imageInput');
const uploadStatus = document.getElementById('uploadStatus');
const palpiteCard = document.getElementById('palpiteCard');
const generateBtn = document.getElementById('generateBtn');
const prediction = document.getElementById('prediction');
const predictionText = document.getElementById('predictionText');
const btnCorrect = document.getElementById('btnCorrect');
const btnWrong = document.getElementById('btnWrong');
const manualInput = document.getElementById('manualInput');
const realValue = document.getElementById('realValue');
const confirmReal = document.getElementById('confirmReal');
const histTableBody = document.querySelector('#histTable tbody');
const lastRound = document.getElementById('lastRound');

let history = []; // guarda palpites {hora,palpite,resultado}
let processed = false;

// upload simples: envia para /upload (server guarda no uploads/)
uploadBtn.addEventListener('click', async () => {
  const file = imageInput.files[0];
  if (!file) {
    uploadStatus.textContent = '⚠️ Selecione uma imagem primeiro.';
    return;
  }

  uploadStatus.textContent = '⏳ Enviando...';
  try {
    const fd = new FormData();
    fd.append('image', file);
    const res = await fetch('/upload', { method: 'POST', body: fd });
    const json = await res.json();
    if (json && json.success) {
      uploadStatus.textContent = '✅ Histórico carregado (ficheiro guardado).';
      processed = true;
      document.getElementById('uploadCard').style.display = 'none';
      palpiteCard.style.display = 'block';
      lastRound.textContent = 'Última rodada: (histórico carregado)';
    } else {
      uploadStatus.textContent = '⚠️ Upload concluído, sem extração.';
      processed = true;
      document.getElementById('uploadCard').style.display = 'none';
      palpiteCard.style.display = 'block';
    }
  } catch (err) {
    console.error(err);
    uploadStatus.textContent = '❌ Falha no upload.';
  }
});

// gerar palpite (quando usuário clica)
generateBtn.addEventListener('click', () => {
  if (!processed) return alert('Carregue o histórico primeiro.');
  // lógica simples para gerar palpite realista (tweakeável)
  const r = Math.random();
  let palpite;
  if (r < 0.1) palpite = (10 + Math.random() * 30).toFixed(2);     // alto
  else if (r < 0.7) palpite = (2 + Math.random() * 8).toFixed(2);  // médio (lilás)
  else palpite = (1 + Math.random() * 0.99).toFixed(2);            // baixo (azul)

  const hora = new Date().toLocaleTimeString('pt-PT', { hour12:false });
  predictionText.innerHTML = `${hora} → 💜 Palpite: <strong>${palpite}x</strong>`;
  prediction.style.display = 'block';
  manualInput.style.display = 'none';
  // guarda pendente no histórico
  history.unshift({ hora, palpite: Number(palpite), resultado: 'Pendente' });
  if (history.length > 50) history.pop();
  renderHistory();
});

// usuário confirma acerto
btnCorrect.addEventListener('click', () => {
  // marca primeiro pendente como acertou
  const entry = history.find(h => h.resultado === 'Pendente');
  if (!entry) return alert('Nenhum palpite pendente.');
  entry.resultado = '✅ Acertou';
  renderHistory();
  prediction.style.display = 'none';
});

// usuário marca erro -> mostra input para inserir real
btnWrong.addEventListener('click', () => {
  manualInput.style.display = 'block';
});

// confirmar valor real
confirmReal.addEventListener('click', () => {
  const v = parseFloat(realValue.value);
  if (isNaN(v)) return alert('Insira um valor válido (ex: 2.45).');
  const entry = history.find(h => h.resultado === 'Pendente');
  if (!entry) return alert('Nenhum palpite pendente.');
  entry.resultado = `❌ Errou - real ${v}x`;
  // opcional: incluir esse valor no histórico para aprendizado (aqui só guardamos)
  renderHistory();
  prediction.style.display = 'none';
  manualInput.style.display = 'none';
  realValue.value = '';
});

function renderHistory() {
  histTableBody.innerHTML = '';
  history.forEach((h, i) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${i+1}</td><td>${h.hora}</td><td>${h.palpite}x</td><td>${h.resultado}</td>`;
    histTableBody.appendChild(tr);
  });
  }
