const express = require('express');
const bcrypt = require('bcryptjs');
const { pool } = require('../db');

const router = express.Router();

// Middleware simples: só deixa passar quem manda a API_KEY certa no header.
// Isso evita que qualquer pessoa na internet use sua API de login.
function checkApiKey(req, res, next) {
  const key = req.header('x-api-key');
  if (!key || key !== process.env.API_KEY) {
    return res.status(401).json({ success: false, message: 'API key inválida.' });
  }
  next();
}

// POST /api/login
// Body esperado: { "username": "...", "password": "..." }
router.post('/login', checkApiKey, async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res
        .status(400)
        .json({ success: false, message: 'Usuário e senha são obrigatórios.' });
    }

    const [rows] = await pool.query(
      'SELECT id, username, password FROM users WHERE username = ? LIMIT 1',
      [username]
    );

    if (rows.length === 0) {
      return res.status(401).json({ success: false, message: 'Usuário ou senha incorretos.' });
    }

    const user = rows[0];
    const senhaCorreta = await bcrypt.compare(password, user.password);

    if (!senhaCorreta) {
      return res.status(401).json({ success: false, message: 'Usuário ou senha incorretos.' });
    }

    // Login aprovado! É aqui que seu painel C++ vai receber o "sucesso".
    return res.status(200).json({
      success: true,
      message: 'Login realizado com sucesso.',
      user: { id: user.id, username: user.username },
    });
  } catch (err) {
    console.error('Erro no /login:', err);
    return res.status(500).json({ success: false, message: 'Erro interno no servidor.' });
  }
});

// GET /api/status - só pra você testar se a API está no ar
router.get('/status', (req, res) => {
  res.json({ online: true, timestamp: new Date().toISOString() });
});

module.exports = router;
