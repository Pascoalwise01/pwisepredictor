let historico = [];
let precisao = 0.97;

const uploadBtn = document.getElementById("uploadBtn");
const gerarBtn = document.getElementById("gerarBtn");
const acertouBtn = document.getElementById("acertouBtn");
const errouBtn = document.getElementById("errouBtn");
const resultadosDiv = document.getElementById("resultados");
const palpiteTexto = document.getElementById("palpiteTexto");

uploadBtn.addEventListener("click", async () => {
  const fileInput = document.getElementById("imageInput");
  const file = fileInput.files[0];

  if (!file) {
    alert("Por favor, seleciona uma imagem do histórico primeiro!");
    return;
  }

  resultadosDiv.innerText = "📸 Processando imagem, aguarde...";
  palpiteTexto.innerText = "Reconhecendo dados...";

  try {
    const { data } = await Tesseract.recognize(file, "por", {
      logger: (m) => {
        if (m.status === "recognizing text") {
          resultadosDiv.innerText = `📖 Lendo texto... ${Math.round(m.progress * 100)}%`;
        }
      },
    });

    const text = data.text.trim();

    if (!text) {
      resultadosDiv.innerText = "⚠️ Não foi possível ler nenhum texto da imagem.";
      return;
    }

    resultadosDiv.innerText = "✅ Histórico lido com sucesso:\n\n" + text;

    // Extrair números (como 1.23, 2x, 3.45 etc.)
    const matches = text.match(/[0-9]+(\.[0-9]+)?/g);
    if (matches && matches.length > 0) {
      historico = matches.map((n) => parseFloat(n)).slice(-10);
      palpiteTexto.innerText = "Histórico carregado! Agora gera o primeiro palpite 🎯";
    } else {
      resultadosDiv.innerText += "\n⚠️ Nenhum número detectado.";
    }
  } catch (err) {
    console.error("Erro OCR:", err);
    resultadosDiv.innerText = "❌ Erro ao processar imagem. Tenta novamente.";
  }
});

gerarBtn.addEventListener("click", () => {
  if (historico.length === 0) {
    alert("Carrega primeiro o histórico!");
    return;
  }

  const media = historico.reduce((a, b) => a + b, 0) / historico.length;
  const desvio = (Math.random() * 0.2 - 0.1) * media * (1 - precisao);
  const palpite = (media + desvio).toFixed(2);

  palpiteTexto.innerText = `🎯 Palpite: ${palpite}x\nPrecisão atual: ${(precisao * 100).toFixed(1)}%`;
});

acertouBtn.addEventListener("click", () => {
  precisao = Math.min(1, precisao + 0.01);
  alert(`✅ Boa! Precisão agora em ${(precisao * 100).toFixed(1)}%.`);
});

errouBtn.addEventListener("click", () => {
  precisao = Math.max(0.8, precisao - 0.02);
  alert(`❌ Ok! Precisão ajustada para ${(precisao * 100).toFixed(1)}%.`);
});
