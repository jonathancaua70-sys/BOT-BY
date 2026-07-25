const express = require('express');
const bcrypt = require('bcryptjs');
const { pool } = require('../db');

const router = express.Router();

// Manda uma notificação pro canal do Discord configurado no webhook.
// Não trava a resposta da API se o webhook falhar - é só um "melhor esforço".
async function notifyWebhook({ username, success, reason, ip }) {
  const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
  if (!webhookUrl) return;

  const embed = {
    title: success ? '✅ Login aprovado' : '❌ Tentativa de login falhou',
    color: success ? 0x2ecc71 : 0xe74c3c,
    fields: [
      { name: 'Usuário', value: username || '(não informado)', inline: true },
      { name: 'IP', value: ip || 'desconhecido', inline: true },
    ],
    timestamp: new Date().toISOString(),
  };

  if (!success && reason) {
    embed.fields.push({ name: 'Motivo', value: reason, inline: false });
  }

  try {
    await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ embeds: [embed] }),
    });
  } catch (err) {
    console.error('⚠️ Não foi possível enviar notificação ao webhook:', err.message);
  }
}

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
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;

    if (!username || !password) {
      console.log(`[LOGIN] Tentativa sem usuário/senha preenchidos (IP: ${ip})`);
      return res
        .status(400)
        .json({ success: false, message: 'Usuário e senha são obrigatórios.' });
    }

    const [rows] = await pool.query(
      'SELECT id, username, password FROM users WHERE username = ? LIMIT 1',
      [username]
    );

    if (rows.length === 0) {
      console.log(`[LOGIN] ❌ Falhou - usuário "${username}" não existe (IP: ${ip})`);
      await notifyWebhook({ username, success: false, reason: 'Usuário não encontrado', ip });
      return res.status(401).json({ success: false, message: 'Usuário ou senha incorretos.' });
    }

    const user = rows[0];
    const senhaCorreta = await bcrypt.compare(password, user.password);

    if (!senhaCorreta) {
      console.log(`[LOGIN] ❌ Falhou - senha incorreta para "${username}" (IP: ${ip})`);
      await notifyWebhook({ username, success: false, reason: 'Senha incorreta', ip });
      return res.status(401).json({ success: false, message: 'Usuário ou senha incorretos.' });
    }

    // Login aprovado! É aqui que seu painel C++ vai receber o "sucesso".
    console.log(`[LOGIN] ✅ Sucesso - "${username}" logou (IP: ${ip})`);
    await notifyWebhook({ username, success: true, ip });

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
