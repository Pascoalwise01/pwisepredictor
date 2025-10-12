// server.js - Pascoal Wise Predictor (simples e robusto)
const express = require('express');
const path = require('path');
const multer = require('multer');
const fs = require('fs');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

// resolve base dir
const root = path.resolve(__dirname);

// serve static files da pasta public
app.use(express.static(path.join(root, 'public')));
app.use(cors());
app.use(express.json());

// cria uploads/ se não existir (usado se quiseres upload)
const uploadsDir = path.join(root, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir);
}

// configura multer para upload opcional (campo 'image')
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadsDir);
  },
  filename: function (req, file, cb) {
    const safe = Date.now() + '-' + file.originalname.replace(/\s+/g, '_');
    cb(null, safe);
  }
});
const upload = multer({ storage });

// rota raiz - garante que index.html é servido
app.get('/', (req, res) => {
  res.sendFile(path.join(root, 'public', 'index.html'));
});

// rota de upload simples (opcional)
app.post('/upload', upload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ success: false, message: 'Nenhuma imagem recebida.' });
  return res.json({ success: true, filename: req.file.filename, path: `/uploads/${req.file.filename}` });
});

// rota de health (útil para debug)
app.get('/status', (req, res) => res.json({ status: 'ok', env: process.env.NODE_ENV || 'prod' }));

app.listen(PORT, () => {
  console.log(`Servidor iniciado na porta ${PORT}`);
});
