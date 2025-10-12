let historico = [];
let precisao = 0.97;

document.getElementById("uploadBtn").addEventListener("click", () => {
  const input = document.getElementById("imageInput");
  const file = input.files[0];
  if (!file) return alert("Escolhe uma imagem do histórico primeiro!");

  Tesseract.recognize(file, "por", {
    logger: (info) => console.log(info)
  }).then(({ data: { text } }) => {
    document.getElementById("resultados").innerText =
      "Histórico detectado:\n" + text;
    historico = text
      .match(/[0-9]+(\.[0-9]+)?/g)
      ?.map((n) => parseFloat(n))
      .slice(-10) || [];
    if (historico.length === 0) alert("Não encontrei valores numéricos!");
  });
});

document.getElementById("gerarBtn").addEventListener("click", () => {
  if (historico.length === 0) return alert("Carrega um histórico primeiro!");
  const media = historico.reduce((a, b) => a + b, 0) / historico.length;
  const desvio = (Math.random() * 0.2 - 0.1) * media * (1 - precisao);
  const palpite = (media + desvio).toFixed(2);
  document.getElementById("palpiteTexto").innerText = `💡 Palpite: ${palpite}x`;
});

document.getElementById("acertouBtn").addEventListener("click", () => {
  precisao = Math.min(1, precisao + 0.01);
  alert(`Boa! Precisão aumentada para ${(precisao * 100).toFixed(1)}%.`);
});

document.getElementById("errouBtn").addEventListener("click", () => {
  precisao = Math.max(0.8, precisao - 0.02);
  alert(`Ok, precisão ajustada para ${(precisao * 100).toFixed(1)}%.`);
});
