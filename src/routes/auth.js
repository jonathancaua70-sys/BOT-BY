const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const { pool } = require('../db');

const router = express.Router();

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  console.error('❌ JWT_SECRET não está definido no .env — defina uma string longa e aleatória.');
}

// Hash "fantasma" usado só para gastar o mesmo tempo de CPU quando o usuário
// não existe, evitando que um atacante descubra usernames válidos medindo o
// tempo de resposta (timing attack).
const DUMMY_HASH = '$2a$10$CwTycUXWue0Thq9StjUM0uJ8Q4kUOgB5UfJfeOfjaJ1SS.EU1zTSm';

// Limita tentativas de login: 10 tentativas por IP a cada 15 minutos.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Muitas tentativas de login. Tente novamente mais tarde.' },
});

// Limita validação de key: 20 tentativas por IP a cada 15 minutos.
const validateKeyLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Muitas tentativas. Tente novamente mais tarde.' },
});

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
// OBS: isso é só uma camada extra contra bots automatizados - não é proteção
// real, já que qualquer chave usada no front-end pode ser lida por quem abrir
// o DevTools. A proteção de verdade é o rate limit + o JWT abaixo.
function checkApiKey(req, res, next) {
  const key = req.header('x-api-key');
  if (!key || key !== process.env.API_KEY) {
    return res.status(401).json({ success: false, message: 'API key inválida.' });
  }
  next();
}

// Middleware que verifica o cookie de sessão (JWT) em rotas protegidas.
function requireAuth(req, res, next) {
  const token = req.cookies?.session;
  if (!token) {
    return res.status(401).json({ success: false, message: 'Não autenticado.' });
  }

  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch (err) {
    return res.status(401).json({ success: false, message: 'Sessão inválida ou expirada.' });
  }
}

// POST /api/login
// Body esperado: { "username": "...", "password": "..." }
router.post('/login', loginLimiter, checkApiKey, async (req, res) => {
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

    const user = rows[0];

    // Sempre roda o bcrypt.compare, mesmo se o usuário não existir, comparando
    // contra um hash fantasma. Isso mantém o tempo de resposta parecido nos
    // dois casos e evita enumeração de usernames por timing attack.
    const senhaCorreta = await bcrypt.compare(password, user ? user.password : DUMMY_HASH);

    if (!user || !senhaCorreta) {
      const reason = !user ? 'Usuário não encontrado' : 'Senha incorreta';
      console.log(`[LOGIN] ❌ Falhou - "${username}" (${reason}) (IP: ${ip})`);
      await notifyWebhook({ username, success: false, reason, ip });
      return res.status(401).json({ success: false, message: 'Usuário ou senha incorretos.' });
    }

    // Login aprovado! Gera um token de sessão assinado e manda como cookie
    // httpOnly - o JavaScript do navegador não consegue ler nem forjar isso.
    const token = jwt.sign(
      { id: user.id, username: user.username },
      JWT_SECRET,
      { expiresIn: '12h' }
    );

    res.cookie('session', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 12 * 60 * 60 * 1000,
    });

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

// GET /api/me
// Retorna os dados do usuário logado com base no cookie de sessão.
// O dashboard deve chamar isso ao carregar, em vez de confiar no localStorage.
router.get('/me', requireAuth, (req, res) => {
  return res.status(200).json({ success: true, user: req.user });
});

// POST /api/logout
// Limpa o cookie de sessão no servidor.
router.post('/logout', (req, res) => {
  res.clearCookie('session');
  return res.status(200).json({ success: true });
});

// POST /api/validatekey
// Body esperado: { "key": "XXXX-XXXX-XXXX-XXXX" }
// Só confere se a key existe no banco - não marca como usada, pode ser
// reaproveitada em várias verificações.
router.post('/validatekey', validateKeyLimiter, checkApiKey, async (req, res) => {
  try {
    const { key } = req.body;

    if (!key) {
      return res.status(400).json({ success: false, message: 'Key é obrigatória.' });
    }

    const [rows] = await pool.query(
      'SELECT id FROM keys_table WHERE key_value = ? LIMIT 1',
      [key]
    );

    if (rows.length === 0) {
      return res.status(401).json({ success: false, message: 'Key inválida.' });
    }

    return res.status(200).json({ success: true, message: 'Key válida.' });
  } catch (err) {
    console.error('Erro no /validatekey:', err);
    return res.status(500).json({ success: false, message: 'Erro interno no servidor.' });
  }
});

// GET /api/status - status completo do sistema
router.get('/status', async (req, res) => {
  try {
    const startTime = Date.now();
    
    // Teste de conexão com banco de dados
    let dbStatus = 'offline';
    let dbPing = 0;
    let dbMessage = '';
    
    try {
      // Usa o pool diretamente em vez de pegar uma conexão
      const result = await pool.query('SELECT 1');
      dbPing = Date.now() - startTime;
      dbStatus = 'online';
      dbMessage = 'Conectado';
      console.log(`[STATUS] DB ping: ${dbPing}ms`);
    } catch (err) {
      dbPing = Date.now() - startTime;
      dbStatus = 'offline';
      dbMessage = err.message;
      console.error(`[STATUS] DB error: ${err.message}`);
    }
    
    const uptime = process.uptime();
    const startTimeIso = new Date(Date.now() - (uptime * 1000)).toISOString();
    
    // Informações de CPU e memória do processo atual
    const memoryUsage = process.memoryUsage();
    const cpuUsage = process.cpuUsage();
    
    res.json({
      online: true,
      timestamp: new Date().toISOString(),
      startTime: startTimeIso,
      uptime: uptime,
      database: {
        status: dbStatus,
        ping: dbPing,
        message: dbMessage,
        host: process.env.DB_HOST,
        port: process.env.DB_PORT
      },
      bot: {
        status: 'online',
        username: 'API ROLUDA#7562',
        uptime: uptime
      },
      system: {
        platform: process.platform,
        nodeVersion: process.version,
        memory: {
          heapUsed: Math.round(memoryUsage.heapUsed / 1024 / 1024),
          heapTotal: Math.round(memoryUsage.heapTotal / 1024 / 1024),
          external: Math.round(memoryUsage.external / 1024 / 1024),
          rss: Math.round(memoryUsage.rss / 1024 / 1024)
        },
        cpu: {
          user: cpuUsage.user,
          system: cpuUsage.system
        }
      }
    });
  } catch (err) {
    console.error(`[STATUS] General error: ${err.message}`);
    res.status(500).json({
      online: false,
      timestamp: new Date().toISOString(),
      error: err.message
    });
  }
});

// GET /api/logs - logs do sistema
router.get('/logs', requireAuth, async (req, res) => {
  try {
    // Logs simulados do sistema (em produção, isso viria de um arquivo ou banco)
    const systemLogs = [
      {
        time: new Date(Date.now() - 3600000).toISOString(),
        type: 'info',
        message: 'Sistema iniciado com sucesso'
      },
      {
        time: new Date(Date.now() - 3500000).toISOString(),
        type: 'success',
        message: 'Bot do Discord conectado'
      },
      {
        time: new Date(Date.now() - 3400000).toISOString(),
        type: 'success',
        message: 'Conexão com banco de dados estabelecida'
      },
      {
        time: new Date(Date.now() - 1800000).toISOString(),
        type: 'info',
        message: 'API rodando na porta 3000'
      }
    ];
    
    // Busca logs de erros do console (simulado)
    const errorLogs = [];
    
    // Informações detalhadas do sistema
    const memoryUsage = process.memoryUsage();
    const cpuUsage = process.cpuUsage();
    
    // Calcula uso de CPU aproximado
    const cpuTotal = cpuUsage.user + cpuUsage.system;
    const cpuPercent = Math.min(100, (cpuTotal / 1000000) * 100); // Aproximação
    
    res.json({
      success: true,
      logs: [...systemLogs, ...errorLogs],
      systemInfo: {
        startTime: new Date(Date.now() - (process.uptime() * 1000)).toISOString(),
        uptime: process.uptime(),
        nodeVersion: process.version,
        platform: process.platform,
        memory: {
          heapUsed: Math.round(memoryUsage.heapUsed / 1024 / 1024),
          heapTotal: Math.round(memoryUsage.heapTotal / 1024 / 1024),
          external: Math.round(memoryUsage.external / 1024 / 1024),
          rss: Math.round(memoryUsage.rss / 1024 / 1024)
        },
        cpu: {
          user: cpuUsage.user,
          system: cpuUsage.system,
          percent: Math.round(cpuPercent)
        },
        applications: [
          {
            name: 'API Node.js',
            pid: process.pid,
            uptime: process.uptime(),
            memory: Math.round(memoryUsage.heapUsed / 1024 / 1024),
            cpu: Math.round(cpuPercent),
            status: 'running'
          },
          {
            name: 'Discord Bot',
            uptime: process.uptime(),
            memory: Math.round(memoryUsage.heapUsed / 1024 / 1024) * 0.3, // Estimativa
            cpu: Math.round(cpuPercent) * 0.4, // Estimativa
            status: 'connected'
          },
          {
            name: 'Database Connection',
            uptime: process.uptime(),
            memory: Math.round(memoryUsage.heapUsed / 1024 / 1024) * 0.1, // Estimativa
            cpu: Math.round(cpuPercent) * 0.1, // Estimativa
            status: 'active'
          }
        ]
      }
    });
  } catch (err) {
    console.error('Erro ao buscar logs:', err);
    res.status(500).json({
      success: false,
      message: 'Erro ao buscar logs'
    });
  }
});

// GET /api/users - listar todos os usuários
router.get('/users', requireAuth, async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT id, username, created_by, created_at, creator_avatar, creator_role, user_avatar FROM users ORDER BY created_at DESC'
    );
    
    res.json({
      success: true,
      users: rows,
      total: rows.length
    });
  } catch (err) {
    console.error('Erro ao buscar usuários:', err);
    res.status(500).json({
      success: false,
      message: 'Erro ao buscar usuários'
    });
  }
});

// GET /api/keys - listar todas as keys
router.get('/keys', requireAuth, async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT id, key_value, created_at, is_used, used_by, used_at FROM keys_table ORDER BY created_at DESC'
    );
    
    res.json({
      success: true,
      keys: rows,
      total: rows.length
    });
  } catch (err) {
    console.error('Erro ao buscar keys:', err);
    res.status(500).json({
      success: false,
      message: 'Erro ao buscar keys'
    });
  }
});

module.exports = router;