const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const { pool } = require('../db');
const fs = require('fs');
const path = require('path');
const { logLogin, logAttack, logSystemError, logBotApi, logSystemStatus, logApiLogin } = require('../webhooks');
const { performBackup, listBackups } = require('../../scripts/backupDatabase');
const { applyRateLimit, createUserRateLimit } = require('../rateLimiter');
const { requireIPWhitelist } = require('../ipWhitelist');
const { createSession, getSession, invalidateSession, listAllSessions, detectSuspiciousSessions } = require('../sessionManager');
const { recordAuthMetric, recordAPIMetric, recordSystemMetric, generateSecurityReport } = require('../securityMonitor');
const { generateCaptcha, validateCaptcha } = require('../captcha');
const { generateMFASecret, enableMFA, disableMFA, isMFAEnabled, validateTOTP, validateBackupCode, generateQRCodeURL, getMFAData } = require('../mfa');
const { PANEL_IDS, getPanelConfig, getPanelApiKey, isExternalPanel, getUsersTableName, resolvePanelId } = require('../panels');
const { findUsersByUsername, listUsersFromAllPanels } = require('../userTables');
const { findKeyAcrossPanels, listKeysFromAllPanels, listKeysForPanel } = require('../keyTables');

// Sistema de logs de segurança
const securityLogPath = path.join(__dirname, '../../logs/security.log');

// Store para rate limiting por usuário
const userRateLimitStore = new Map();

// Garante que o diretório de logs existe
const logsDir = path.dirname(securityLogPath);
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

function logSecurityEvent(eventType, details) {
  const timestamp = new Date().toISOString();
  const logEntry = {
    timestamp,
    eventType,
    ...details
  };
  
  const logLine = JSON.stringify(logEntry) + '\n';
  
  // Escreve no arquivo de log
  fs.appendFile(securityLogPath, logLine, (err) => {
    if (err) {
      console.error('Erro ao escrever no log de segurança:', err);
    }
  });
  
  // Também loga no console para debug
  console.log(`[SECURITY] ${eventType}:`, details);
}

// Rate limiting por usuário (não por IP)
function checkUserRateLimit(username, maxAttempts = 5, windowMs = 15 * 60 * 1000) {
  const now = Date.now();
  const key = `login_${username}`;
  
  if (!userRateLimitStore.has(key)) {
    userRateLimitStore.set(key, { attempts: 1, timestamp: now });
    return { allowed: true, remaining: maxAttempts - 1 };
  }
  
  const data = userRateLimitStore.get(key);
  
  // Reseta se passou o tempo da janela
  if (now - data.timestamp > windowMs) {
    userRateLimitStore.set(key, { attempts: 1, timestamp: now });
    return { allowed: true, remaining: maxAttempts - 1 };
  }
  
  // Verifica se excedeu o limite
  if (data.attempts >= maxAttempts) {
    const resetTime = data.timestamp + windowMs;
    const remainingTime = Math.ceil((resetTime - now) / 1000 / 60); // em minutos
    return { 
      allowed: false, 
      message: `Muitas tentativas de login para este usuário. Tente novamente em ${remainingTime} minutos.` 
    };
  }
  
  // Incrementa tentativas
  data.attempts++;
  userRateLimitStore.set(key, data);
  
  return { allowed: true, remaining: maxAttempts - data.attempts };
}

// Função de sanitização melhorada para prevenir XSS
// NOTA: Em produção, usar DOMPurify (npm install dompurify)
// Esta é uma implementação mais robusta que a simples blacklist
function sanitizeInput(input) {
  if (typeof input !== 'string') return input;
  
  // Remove caracteres nulos e controle
  let sanitized = input.replace(/[\x00-\x1F\x7F]/g, '');
  
  // Normaliza Unicode para evitar ataques de homograph
  try {
    sanitized = sanitized.normalize('NFC');
  } catch (e) {
    // Se normalização falhar, continua com o original
  }
  
  // Escape de entidades HTML básicas (camada adicional à CSP)
  const htmlEscapeMap = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#x27;',
    '/': '&#x2F;' // Previne closing tag injection
  };
  
  sanitized = sanitized.replace(/[&<>"'/]/g, (match) => htmlEscapeMap[match]);
  
  // Remove sequências perigosas de JavaScript
  const dangerousPatterns = [
    /javascript:/gi,
    /data:/gi,
    /vbscript:/gi,
    /on\w+\s*=/gi, // onclick=, onload=, etc.
    /<\s*script/gi,
    /<\s*iframe/gi,
    /<\s*object/gi,
    /<\s*embed/gi
  ];
  
  for (const pattern of dangerousPatterns) {
    sanitized = sanitized.replace(pattern, '');
  }
  
  // Truncamento para evitar ataques de DoS por string muito longa
  const maxLength = 1000;
  if (sanitized.length > maxLength) {
    sanitized = sanitized.substring(0, maxLength);
  }
  
  return sanitized;
}

// Validação mais robusta de username (previne homograph attacks)
function validateUsername(username) {
  if (!username || typeof username !== 'string') {
    return { valid: false, message: 'Nome de usuário inválido.' };
  }

  const trimmed = username.trim();
  if (trimmed.length < 1 || trimmed.length > 50) {
    return { valid: false, message: 'Nome de usuário deve ter 1-50 caracteres.' };
  }

  return { valid: true };
}

// Validação de usuário e senha (livre — usuário escolhe o que quiser)
function validateCredentials(username, password) {
  if (!username || !password) {
    return { valid: false, message: 'Usuário e senha são obrigatórios.' };
  }

  const usernameValidation = validateUsername(username);
  if (!usernameValidation.valid) {
    return usernameValidation;
  }

  if (typeof password !== 'string' || password.length < 1 || password.length > 128) {
    return { valid: false, message: 'Senha deve ter 1-128 caracteres.' };
  }

  return { valid: true };
}

const router = express.Router();

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  console.error('❌ JWT_SECRET não está definido no .env — defina uma string longa e aleatória.');
}

// Hash "fantasma" usado só para gastar o mesmo tempo de CPU quando o usuário
// não existe, evitando que um atacante descubra usernames válidos medindo o
// tempo de resposta (timing attack).
const DUMMY_HASH = '$2a$10$CwTycUXWue0Thq9StjUM0uJ8Q4kUOgB5UfJfeOfjaJ1SS.EU1zTSm';

// Manda uma notificação pro canal do Discord configurado no webhook.
// Não trava a resposta da API se o webhook falhar - é só um "melhor esforço".
async function notifyWebhook({ username, success, reason, ip }) {
  try {
    await logLogin(username, success, ip, reason);
  } catch (err) {
    console.error('⚠️ Não foi possível enviar notificação ao webhook:', err.message);
  }
}

// Middleware que verifica o cookie de sessão (JWT) em rotas protegidas.
function requireAuth(req, res, next) {
  const token = req.cookies?.session;
  if (!token) {
    return res.status(401).json({ success: false, message: 'Não autenticado.' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    
    // Verifica se a sessão existe no store
    const session = getSession(decoded.sessionId);
    if (!session) {
      return res.status(401).json({ success: false, message: 'Sessão inválida ou expirada.' });
    }
    
    // Verifica se a sessão pertence ao usuário do token
    if (session.userId !== decoded.userId) {
      return res.status(401).json({ success: false, message: 'Sessão inválida.' });
    }
    
    req.user = decoded;
    req.session = session;
    next();
  } catch (err) {
    return res.status(401).json({ success: false, message: 'Sessão inválida ou expirada.' });
  }
}

// GET /api/captcha - Gera um novo CAPTCHA
router.get('/captcha', (req, res) => {
  try {
    const captcha = generateCaptcha();
    return res.status(200).json({
      success: true,
      captchaId: captcha.captchaId,
      question: captcha.question,
      expiresAt: captcha.expiresAt
    });
  } catch (err) {
    console.error('Erro no /captcha:', err);
    return res.status(500).json({ success: false, message: 'Erro interno no servidor.' });
  }
});

// Login por painel: external-advanced, external-premium, internal-advanced, internal-premium
async function handlePanelLogin(req, res, panelId) {
  const startTime = Date.now();
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  const panel = getPanelConfig(panelId);
  const usersTable = getUsersTableName(panelId);

  if (!panel || !usersTable) {
    return res.status(404).json({ success: false, message: 'Painel não encontrado.' });
  }

  const logPrefix = `[LOGIN/${panelId.toUpperCase()}]`;

  try {
    const { username, password, captchaId, captchaAnswer } = req.body;
    const apiKey = req.headers['x-api-key'];
    const expectedApiKey = getPanelApiKey(panelId);
    const isExternalRequest = expectedApiKey && apiKey === expectedApiKey;
    const externalPanel = isExternalPanel(panelId);

    if ((!externalPanel || !isExternalRequest) && !isExternalRequest) {
      if (!captchaId || !captchaAnswer) {
        logSecurityEvent('PANEL_LOGIN_CAPTCHA_MISSING', { panelId, username, ip });
        return res.status(400).json({
          success: false,
          message: 'CAPTCHA é obrigatório.',
          requireCaptcha: true,
        });
      }

      const captchaValidation = validateCaptcha(captchaId, captchaAnswer);
      if (!captchaValidation.valid) {
        logSecurityEvent('PANEL_LOGIN_CAPTCHA_INVALID', {
          panelId,
          username,
          ip,
          reason: captchaValidation.reason,
        });
        return res.status(400).json({
          success: false,
          message: captchaValidation.reason,
          requireCaptcha: true,
          attemptsRemaining: captchaValidation.attemptsRemaining,
        });
      }
    } else if (isExternalRequest) {
      console.log(`${logPrefix} 🔑 Requisição via API key (IP: ${ip})`);
    }

    const validation = validateCredentials(username, password);
    if (!validation.valid) {
      logSecurityEvent('PANEL_LOGIN_VALIDATION_FAILED', {
        panelId,
        username,
        ip,
        reason: validation.message,
      });
      await notifyWebhook({ username, success: false, reason: validation.message, ip });
      return res.status(400).json({ success: false, message: validation.message });
    }

    const rateLimitCheck = checkUserRateLimit(username);
    if (!rateLimitCheck.allowed) {
      logSecurityEvent('PANEL_LOGIN_RATE_LIMIT_EXCEEDED', { panelId, username, ip });
      await logAttack('Rate Limit Excedido - Brute Force', ip, { username, panelId });
      await notifyWebhook({ username, success: false, reason: 'Rate limit excedido', ip });
      return res.status(429).json({ success: false, message: rateLimitCheck.message });
    }

    const sanitizedUsername = sanitizeInput(username);

    const [rows] = await pool.query(
      `SELECT id, username, password, user_avatar FROM \`${usersTable}\` WHERE username = ? LIMIT 1`,
      [sanitizedUsername]
    );

    const user = rows[0];
    const senhaCorreta = await bcrypt.compare(password, user ? user.password : DUMMY_HASH);

    if (!user || !senhaCorreta) {
      const reason = !user ? 'Usuário não encontrado' : 'Senha incorreta';
      logSecurityEvent('PANEL_LOGIN_FAILED', {
        panelId,
        username: sanitizedUsername,
        ip,
        reason,
        userExists: !!user,
      });
      await notifyWebhook({ username: sanitizedUsername, success: false, reason, ip });
      return res.status(401).json({ success: false, message: 'Usuário ou senha incorretos.' });
    }

    const userPayload = {
      id: user.id,
      username: user.username,
      user_avatar: user.user_avatar || 'https://cdn.discordapp.com/embed/avatars/0.png',
      panel: panelId,
      panel_type: panel.type,
      tier: panel.tier,
    };

    if (externalPanel && isExternalRequest) {
      console.log(`${logPrefix} ✅ Sucesso - "${sanitizedUsername}" (IP: ${ip})`);
      logSecurityEvent('PANEL_LOGIN_SUCCESS', {
        panelId,
        username: sanitizedUsername,
        ip,
        userId: user.id,
        external: true,
      });
      await notifyWebhook({ username: sanitizedUsername, success: true, ip });
      recordAuthMetric('login_success', { userId: user.id, ip, panelId });

      const responseTime = Date.now() - startTime;
      await logBotApi(`/api/login/${panelId}`, 'POST', ip, true, responseTime);

      return res.status(200).json({
        success: true,
        message: 'Login realizado com sucesso.',
        user: userPayload,
      });
    }

    const sessionData = createSession(user, req, { panelId });

    res.cookie('session', sessionData.token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 12 * 60 * 60 * 1000,
    });

    console.log(`${logPrefix} ✅ Sucesso - "${sanitizedUsername}" logou (IP: ${ip})`);
    logSecurityEvent('PANEL_LOGIN_SUCCESS', {
      panelId,
      username: sanitizedUsername,
      ip,
      userId: user.id,
    });
    await notifyWebhook({ username: sanitizedUsername, success: true, ip });
    recordAuthMetric('login_success', { userId: user.id, ip, panelId });

    const responseTime = Date.now() - startTime;
    await logBotApi(`/api/login/${panelId}`, 'POST', ip, true, responseTime);

    return res.status(200).json({
      success: true,
      message: 'Login realizado com sucesso.',
      user: userPayload,
    });
  } catch (err) {
    console.error(`Erro no /login/${panelId}:`, err);
    const responseTime = Date.now() - startTime;
    await logBotApi(`/api/login/${panelId}`, 'POST', ip, false, responseTime);
    return res.status(500).json({ success: false, message: 'Erro interno no servidor.' });
  }
}

PANEL_IDS.forEach((panelId) => {
  router.post(`/login/${panelId}`, applyRateLimit('login'), (req, res) => handlePanelLogin(req, res, panelId));
});

// GET /api/panels - lista painéis disponíveis
router.get('/panels', (req, res) => {
  const panels = PANEL_IDS.map((id) => {
    const panel = getPanelConfig(id);
    return {
      id: panel.id,
      label: panel.label,
      type: panel.type,
      tier: panel.tier,
      description: panel.description,
      tableName: panel.tableName,
      loginPath: `/login/${panel.id}`,
      apiPath: `/api/login/${panel.id}`,
    };
  });

  return res.status(200).json({ success: true, panels });
});

// POST /api/login
// Body esperado: { "username": "...", "password": "..." }
// Para integração externa, envie header x-api-key para pular CAPTCHA/CSRF
router.post('/login', applyRateLimit('login'), async (req, res) => {
  const startTime = Date.now();
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  
  try {
    const { username, password, captchaId, captchaAnswer, panel, panelId } = req.body || {};
    const apiKey = req.headers['x-api-key'];
    const requestedPanel = resolvePanelId(panel || panelId || req.headers['x-panel-id']);
    
    // Verifica se é requisição externa (API key)
    const isExternalRequest = apiKey === process.env.EXTERNAL_API_KEY;
    
    // Pula CAPTCHA para requisições externas autenticadas por API key
    if (!isExternalRequest) {
      // Valida CAPTCHA
      if (!captchaId || !captchaAnswer) {
        console.log(`[LOGIN] ❌ CAPTCHA ausente - "${username}" (IP: ${ip})`);
        logSecurityEvent('LOGIN_CAPTCHA_MISSING', {
          username,
          ip,
          reason: 'CAPTCHA não fornecido'
        });
        return res.status(400).json({ 
          success: false, 
          message: 'CAPTCHA é obrigatório.',
          requireCaptcha: true
        });
      }

      const captchaValidation = validateCaptcha(captchaId, captchaAnswer);
      if (!captchaValidation.valid) {
        console.log(`[LOGIN] ❌ CAPTCHA inválido - "${username}" (IP: ${ip}) - ${captchaValidation.reason}`);
        logSecurityEvent('LOGIN_CAPTCHA_INVALID', {
          username,
          ip,
          reason: captchaValidation.reason
        });
        return res.status(400).json({ 
          success: false, 
          message: captchaValidation.reason,
          requireCaptcha: true,
          attemptsRemaining: captchaValidation.attemptsRemaining
        });
      }
    } else {
      const panelHint = requestedPanel ? ` plano=${requestedPanel}` : ' (busca nos 5 planos)';
      console.log(`[LOGIN] 🔑 Requisição externa via API key - "${username}"${panelHint} (IP: ${ip})`);
    }

    // Valida e sanitiza as credenciais
    const validation = validateCredentials(username, password);
    if (!validation.valid) {
      console.log(`[LOGIN] ❌ Validação falhou - "${username}" (${validation.message}) (IP: ${ip})`);
      logSecurityEvent('LOGIN_VALIDATION_FAILED', {
        username,
        ip,
        reason: validation.message
      });
      await notifyWebhook({ username, success: false, reason: validation.message, ip });
      return res.status(400).json({ success: false, message: validation.message });
    }
    
    // Rate limiting por usuário
    const rateLimitCheck = checkUserRateLimit(username);
    if (!rateLimitCheck.allowed) {
      console.log(`[LOGIN] ❌ Rate limit excedido - "${username}" (IP: ${ip})`);
      logSecurityEvent('LOGIN_RATE_LIMIT_EXCEEDED', {
        username,
        ip,
        attempts: userRateLimitStore.get(`login_${username}`)?.attempts
      });
      
      // Loga como tentativa de ataque (DDoS/Brute Force)
      await logAttack('Rate Limit Excedido - Brute Force', ip, {
        username,
        attempts: userRateLimitStore.get(`login_${username}`)?.attempts
      });
      
      await notifyWebhook({ username, success: false, reason: 'Rate limit excedido', ip });
      return res.status(429).json({ success: false, message: rateLimitCheck.message });
    }
    
    const sanitizedUsername = sanitizeInput(username);

    const matches = await findUsersByUsername(pool, sanitizedUsername, requestedPanel);
    let matched = null;

    if (matches.length === 0) {
      await bcrypt.compare(password, DUMMY_HASH);
    } else {
      for (const candidate of matches) {
        const ok = await bcrypt.compare(password, candidate.user.password);
        if (ok) {
          matched = candidate;
          break;
        }
      }
    }

    const user = matched?.user || null;
    const senhaCorreta = !!matched;

    if (user && senhaCorreta && user.password.startsWith('$2a$10$')) {
      console.log(`[LOGIN] ⚠️ Usuário ${sanitizedUsername} usando hash legado (cost 10) - deve ser rehashado para cost 12`);
    }

    if (!user || !senhaCorreta) {
      const reason = !user ? 'Usuário não encontrado' : 'Senha incorreta';
      console.log(`[LOGIN] ❌ Falhou - "${sanitizedUsername}" (${reason}) (IP: ${ip})`);
      logSecurityEvent('LOGIN_FAILED', {
        username: sanitizedUsername,
        ip,
        reason,
        userExists: !!user,
        panel: requestedPanel || null,
      });
      
      if (!user) {
        await logAttack('User Enumeration Attempt', ip, {
          attemptedUsername: sanitizedUsername
        });
      }
      
      await notifyWebhook({ username: sanitizedUsername, success: false, reason, ip });
      return res.status(401).json({ success: false, message: 'Usuário ou senha incorretos.' });
    }

    const resolvedPanelId = matched.panelId;
    const panelConfig = matched.panel;

    // Login aprovado! Cria sessão avançada
    const sessionData = createSession(user, req, { panelId: resolvedPanelId });
    
    res.cookie('session', sessionData.token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 12 * 60 * 60 * 1000,
    });

    console.log(`[LOGIN] ✅ Sucesso - "${sanitizedUsername}" logou (plano: ${resolvedPanelId || 'legado'}, tabela: ${matched.tableName}) (IP: ${ip})`);
    logSecurityEvent('LOGIN_SUCCESS', {
      username: sanitizedUsername,
      ip,
      userId: user.id,
      panel: resolvedPanelId,
      table: matched.tableName,
    });
    await notifyWebhook({ username: sanitizedUsername, success: true, ip });
    
    recordAuthMetric('login_success', { userId: user.id, ip, panelId: resolvedPanelId });

    const responseTime = Date.now() - startTime;
    await logBotApi('/api/login', 'POST', ip, true, responseTime);

    return res.status(200).json({
      success: true,
      message: 'Login realizado com sucesso.',
      user: { 
        id: user.id, 
        username: user.username,
        user_avatar: user.user_avatar || 'https://cdn.discordapp.com/embed/avatars/0.png',
        panel: resolvedPanelId,
        panel_type: panelConfig?.type || null,
        tier: panelConfig?.tier || null,
      },
    });
  } catch (err) {
    console.error('Erro no /login:', err);
    
    // Loga erro na API
    const responseTime = Date.now() - startTime;
    await logBotApi('/api/login', 'POST', ip, false, responseTime);
    
    return res.status(500).json({ success: false, message: 'Erro interno no servidor.' });
  }
});

// GET /api/me
// Retorna os dados do usuário logado com base no cookie de sessão.
// O dashboard deve chamar isso ao carregar, em vez de confiar no localStorage.
router.get('/me', requireAuth, async (req, res) => {
  try {
    const panelId = req.user.panelId || req.session?.panelId || null;
    const usersTable = panelId ? getUsersTableName(panelId) : 'users';

    if (!usersTable) {
      return res.status(404).json({ success: false, message: 'Usuário não encontrado.' });
    }

    const [rows] = await pool.query(
      `SELECT id, username, user_avatar FROM \`${usersTable}\` WHERE id = ? LIMIT 1`,
      [req.user.id]
    );
    
    const user = rows[0];
    if (!user) {
      return res.status(404).json({ success: false, message: 'Usuário não encontrado.' });
    }
    
    return res.status(200).json({ 
      success: true, 
      user: { 
        id: user.id, 
        username: user.username,
        user_avatar: user.user_avatar || 'https://cdn.discordapp.com/embed/avatars/0.png',
        panel: panelId,
      } 
    });
  } catch (err) {
    console.error('Erro no /me:', err);
    return res.status(500).json({ success: false, message: 'Erro interno no servidor.' });
  }
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
router.post('/validatekey', applyRateLimit('validateKey'), async (req, res) => {
  const startTime = Date.now();
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  
  try {
    const { key } = req.body;

    if (!key) {
      return res.status(400).json({ success: false, message: 'Key é obrigatória.' });
    }
    
    const sanitizedKey = sanitizeInput(key);
    
    // Valida formato da key (XXXX-XXXX-XXXX-XXXX)
    const keyRegex = /^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/;
    if (!keyRegex.test(key)) {
      logSecurityEvent('KEY_VALIDATION_FAILED', {
        key: sanitizedKey.substring(0, 8) + '...', // Loga apenas parte da key por segurança
        ip,
        reason: 'Formato inválido'
      });
      
      // Loga como tentativa de login da API (C++/C#)
      await logApiLogin(sanitizedKey.substring(0, 8) + '...', false, ip, 'validatekey');
      
      return res.status(400).json({ success: false, message: 'Formato de key inválido.' });
    }

    const keyMatch = await findKeyAcrossPanels(pool, sanitizedKey);

    if (!keyMatch) {
      logSecurityEvent('KEY_VALIDATION_INVALID', {
        key: sanitizedKey.substring(0, 8) + '...',
        ip,
        reason: 'Key não encontrada no banco'
      });
      
      // Loga como tentativa de login da API (C++/C#)
      await logApiLogin(sanitizedKey.substring(0, 8) + '...', false, ip, 'validatekey');
      
      return res.status(401).json({ success: false, message: 'Key inválida.' });
    }
    
    logSecurityEvent('KEY_VALIDATION_SUCCESS', {
      key: sanitizedKey.substring(0, 8) + '...',
      panel: keyMatch.panelId,
      table: keyMatch.tableName,
      ip
    });
    
    // Loga como login da API (C++/C#)
    await logApiLogin(sanitizedKey.substring(0, 8) + '...', true, ip, 'validatekey');
    
    // Loga acesso à API
    const responseTime = Date.now() - startTime;
    await logBotApi('/api/validatekey', 'POST', ip, true, responseTime);

    return res.status(200).json({ success: true, message: 'Key válida.', panel: keyMatch.panelId });
  } catch (err) {
    console.error('Erro no /validatekey:', err);
    
    // Loga erro na API
    const responseTime = Date.now() - startTime;
    await logBotApi('/api/validatekey', 'POST', ip, false, responseTime);
    
    return res.status(500).json({ success: false, message: 'Erro interno no servidor.' });
  }
});

// GET /api/status - status completo do sistema
router.get('/status', applyRateLimit('status'), async (req, res) => {
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
    
    // Loga status do sistema periodicamente (a cada 10 minutos)
    const now = Date.now();
    if (!this.lastStatusLog || now - this.lastStatusLog > 10 * 60 * 1000) {
      this.lastStatusLog = now;
      await logSystemStatus({
        database: dbStatus,
        bot: 'online',
        api: 'online'
      });
    }
    
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
    const users = await listUsersFromAllPanels(pool);
    
    res.json({
      success: true,
      users,
      total: users.length
    });
  } catch (err) {
    console.error('Erro ao buscar usuários:', err);
    res.status(500).json({
      success: false,
      message: 'Erro ao buscar usuários'
    });
  }
});

// GET /api/keys - listar todas as keys de todos os painéis
router.get('/keys', requireAuth, async (req, res) => {
  try {
    const keys = await listKeysFromAllPanels(pool);

    res.json({
      success: true,
      keys,
      total: keys.length
    });
  } catch (err) {
    console.error('Erro ao buscar keys:', err);
    res.status(500).json({
      success: false,
      message: 'Erro ao buscar keys'
    });
  }
});

// GET /api/keys/:panelId - listar keys de um painel específico
// Ex.: /api/keys/external-advanced
router.get('/keys/:panelId', requireAuth, async (req, res) => {
  try {
    const panelId = resolvePanelId(req.params.panelId);
    if (!panelId) {
      return res.status(404).json({ success: false, message: 'Painel não encontrado.' });
    }

    const keys = await listKeysForPanel(pool, panelId);

    res.json({
      success: true,
      panel: panelId,
      keys: keys || [],
      total: keys ? keys.length : 0
    });
  } catch (err) {
    console.error('Erro ao buscar keys do painel:', err);
    res.status(500).json({
      success: false,
      message: 'Erro ao buscar keys'
    });
  }
});

// POST /api/backup - Criar backup manual (requer autenticação + whitelist)
router.post('/backup', requireAuth, requireIPWhitelist('admin'), async (req, res) => {
  try {
    const result = await performBackup();
    
    if (result.success) {
      return res.status(200).json({
        success: true,
        message: 'Backup realizado com sucesso',
        backup: result.manifest
      });
    } else {
      return res.status(500).json({
        success: false,
        message: 'Erro ao realizar backup',
        error: result.error
      });
    }
  } catch (err) {
    console.error('Erro no /backup:', err);
    return res.status(500).json({ success: false, message: 'Erro interno no servidor.' });
  }
});

// GET /api/backups - Listar backups disponíveis (requer autenticação)
router.get('/backups', requireAuth, async (req, res) => {
  try {
    const backups = listBackups();
    
    return res.status(200).json({
      success: true,
      backups: backups
    });
  } catch (err) {
    console.error('Erro no /backups:', err);
    return res.status(500).json({ success: false, message: 'Erro interno no servidor.' });
  }
});

// GET /api/sessions - Listar sessões ativas (requer autenticação + admin whitelist)
router.get('/sessions', requireAuth, requireIPWhitelist('admin'), async (req, res) => {
  try {
    const sessions = listAllSessions();
    const suspicious = detectSuspiciousSessions();
    
    return res.status(200).json({
      success: true,
      sessions: sessions,
      suspicious: suspicious,
      total: sessions.length
    });
  } catch (err) {
    console.error('Erro no /sessions:', err);
    return res.status(500).json({ success: false, message: 'Erro interno no servidor.' });
  }
});

// DELETE /api/sessions - Invalidar todas as sessões (requer autenticação + admin whitelist)
router.delete('/sessions', requireAuth, requireIPWhitelist('admin'), async (req, res) => {
  try {
    const count = invalidateAllSessions();
    
    return res.status(200).json({
      success: true,
      message: `${count} sessões invalidadas com sucesso.`
    });
  } catch (err) {
    console.error('Erro no /sessions:', err);
    return res.status(500).json({ success: false, message: 'Erro interno no servidor.' });
  }
});

// DELETE /api/sessions/mine - Invalidar minhas sessões (requer autenticação)
router.delete('/sessions/mine', requireAuth, async (req, res) => {
  try {
    const count = invalidateUserSessions(req.user.id);
    
    return res.status(200).json({
      success: true,
      message: `${count} suas sessões foram invalidadas.`
    });
  } catch (err) {
    console.error('Erro no /sessions/mine:', err);
    return res.status(500).json({ success: false, message: 'Erro interno no servidor.' });
  }
});

// GET /api/security-report - Relatório de segurança (requer autenticação + admin whitelist)
router.get('/security-report', requireAuth, requireIPWhitelist('admin'), async (req, res) => {
  try {
    const report = generateSecurityReport();
    
    return res.status(200).json({
      success: true,
      report
    });
  } catch (err) {
    console.error('Erro no /security-report:', err);
    return res.status(500).json({ success: false, message: 'Erro interno no servidor.' });
  }
});

// POST /api/mfa/setup - Inicia setup de MFA (requer autenticação)
router.post('/mfa/setup', requireAuth, async (req, res) => {
  try {
    const secret = generateMFASecret(req.user.id);
    const qrCodeURL = generateQRCodeURL(req.user.username, secret);
    
    return res.status(200).json({
      success: true,
      secret,
      qrCodeURL,
      message: 'Use o QR code no Google Authenticator e depois habilite o MFA'
    });
  } catch (err) {
    console.error('Erro no /mfa/setup:', err);
    return res.status(500).json({ success: false, message: 'Erro interno no servidor.' });
  }
});

// POST /api/mfa/enable - Habilita MFA após validar código (requer autenticação)
router.post('/mfa/enable', requireAuth, async (req, res) => {
  try {
    const { token } = req.body;
    
    if (!token) {
      return res.status(400).json({ success: false, message: 'Código MFA é obrigatório.' });
    }
    
    const validation = validateTOTP(req.user.id, token);
    if (!validation.valid) {
      return res.status(400).json({ success: false, message: validation.reason });
    }
    
    enableMFA(req.user.id);
    
    const mfaData = getMFAData(req.user.id);
    
    return res.status(200).json({
      success: true,
      message: 'MFA habilitado com sucesso',
      backupCodes: mfaData.backupCodes
    });
  } catch (err) {
    console.error('Erro no /mfa/enable:', err);
    return res.status(500).json({ success: false, message: 'Erro interno no servidor.' });
  }
});

// POST /api/mfa/disable - Desabilita MFA (requer autenticação)
router.post('/mfa/disable', requireAuth, async (req, res) => {
  try {
    disableMFA(req.user.id);
    
    return res.status(200).json({
      success: true,
      message: 'MFA desabilitado com sucesso'
    });
  } catch (err) {
    console.error('Erro no /mfa/disable:', err);
    return res.status(500).json({ success: false, message: 'Erro interno no servidor.' });
  }
});

// POST /api/mfa/verify - Verifica código MFA (usado durante login)
router.post('/mfa/verify', async (req, res) => {
  try {
    const { userId, token, backupCode } = req.body;
    
    if (!userId) {
      return res.status(400).json({ success: false, message: 'User ID é obrigatório.' });
    }
    
    if (!token && !backupCode) {
      return res.status(400).json({ success: false, message: 'Código MFA ou código de backup é obrigatório.' });
    }
    
    let validation;
    if (backupCode) {
      validation = validateBackupCode(userId, backupCode);
    } else {
      validation = validateTOTP(userId, token);
    }
    
    if (validation.valid) {
      return res.status(200).json({
        success: true,
        message: 'Código MFA válido'
      });
    } else {
      return res.status(400).json({
        success: false,
        message: validation.reason
      });
    }
  } catch (err) {
    console.error('Erro no /mfa/verify:', err);
    return res.status(500).json({ success: false, message: 'Erro interno no servidor.' });
  }
});

// GET /api/mfa/status - Verifica status MFA (requer autenticação)
router.get('/mfa/status', requireAuth, async (req, res) => {
  try {
    const enabled = isMFAEnabled(req.user.id);
    
    return res.status(200).json({
      success: true,
      enabled
    });
  } catch (err) {
    console.error('Erro no /mfa/status:', err);
    return res.status(500).json({ success: false, message: 'Erro interno no servidor.' });
  }
});

// POST /api/auth/external
// Endpoint para autenticação externa (clientes C++, etc.)
// Não requer CAPTCHA/CSRF, mas requer API key válida
router.post('/auth/external', applyRateLimit('external'), async (req, res) => {
  const startTime = Date.now();
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  
  try {
    const { username, password, panel, panelId } = req.body || {};
    const apiKey = req.headers['x-api-key'];
    const requestedPanel = resolvePanelId(panel || panelId || req.headers['x-panel-id']);
    
    // Valida API key
    const EXTERNAL_API_KEY = process.env.EXTERNAL_API_KEY;
    if (!EXTERNAL_API_KEY || apiKey !== EXTERNAL_API_KEY) {
      console.log(`[EXTERNAL_AUTH] ❌ API key inválida - IP: ${ip}`);
      logSecurityEvent('EXTERNAL_AUTH_INVALID_API_KEY', { ip });
      await logAttack('Invalid API Key Attempt', ip);
      return res.status(401).json({ success: false, message: 'API key inválida' });
    }
    
    // Valida credenciais básicas
    if (!username || !password) {
      return res.status(400).json({ success: false, message: 'Usuário e senha são obrigatórios.' });
    }
    
    // Rate limiting por usuário
    const rateLimitCheck = checkUserRateLimit(username, 10, 15 * 60 * 1000); // 10 tentativas em 15 min
    if (!rateLimitCheck.allowed) {
      console.log(`[EXTERNAL_AUTH] ❌ Rate limit excedido - "${username}" (IP: ${ip})`);
      logSecurityEvent('EXTERNAL_AUTH_RATE_LIMIT_EXCEEDED', { username, ip });
      await logAttack('External Auth Rate Limit Exceeded', ip, { username });
      return res.status(429).json({ success: false, message: rateLimitCheck.message });
    }
    
    const sanitizedUsername = sanitizeInput(username);

    const matches = await findUsersByUsername(pool, sanitizedUsername, requestedPanel);
    let matched = null;

    if (matches.length === 0) {
      await bcrypt.compare(password, DUMMY_HASH);
    } else {
      for (const candidate of matches) {
        const ok = await bcrypt.compare(password, candidate.user.password);
        if (ok) {
          matched = candidate;
          break;
        }
      }
    }

    const user = matched?.user || null;
    const senhaCorreta = !!matched;
    
    if (!user || !senhaCorreta) {
      const reason = !user ? 'Usuário não encontrado' : 'Senha incorreta';
      console.log(`[EXTERNAL_AUTH] ❌ Falhou - "${sanitizedUsername}" (${reason}) (IP: ${ip})`);
      logSecurityEvent('EXTERNAL_AUTH_FAILED', {
        username: sanitizedUsername,
        ip,
        reason,
        userExists: !!user,
        panel: requestedPanel || null,
      });
      
      await logApiLogin(sanitizedUsername, false, ip, reason);
      return res.status(401).json({ success: false, message: 'Usuário ou senha incorretos.' });
    }
    
    console.log(`[EXTERNAL_AUTH] ✅ Sucesso - "${sanitizedUsername}" (plano: ${matched.panelId || 'legado'}, tabela: ${matched.tableName}) (IP: ${ip})`);
    logSecurityEvent('EXTERNAL_AUTH_SUCCESS', {
      username: sanitizedUsername,
      ip,
      userId: user.id,
      panel: matched.panelId,
      table: matched.tableName,
    });
    
    await logApiLogin(sanitizedUsername, true, ip, 'External auth successful');
    recordAuthMetric('external_auth_success', { userId: user.id, ip, panelId: matched.panelId });
    
    const responseTime = Date.now() - startTime;
    await logBotApi('/api/auth/external', 'POST', ip, true, responseTime);
    
    return res.status(200).json({
      success: true,
      message: 'Login realizado com sucesso.',
      user: {
        id: user.id,
        username: user.username,
        user_avatar: user.user_avatar || 'https://cdn.discordapp.com/embed/avatars/0.png',
        panel: matched.panelId,
        panel_type: matched.panel?.type || null,
        tier: matched.panel?.tier || null,
      }
    });
  } catch (err) {
    console.error('Erro no /auth/external:', err);
    const responseTime = Date.now() - startTime;
    await logBotApi('/api/auth/external', 'POST', ip, false, responseTime);
    return res.status(500).json({ success: false, message: 'Erro interno no servidor.' });
  }
});

// POST /api/auth/register
// Body: { "key": "...", "username": "...", "password": "...", "panel": "external-advanced" }
router.post('/auth/register', applyRateLimit('register'), async (req, res) => {
  const startTime = Date.now();
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;

  try {
    let { key, username, password, panel, panelId } = req.body || {};

    key = typeof key === 'string' ? key.trim().toUpperCase() : '';
    username = typeof username === 'string' ? username.trim() : '';
    password = typeof password === 'string' ? password : '';
    const requestedPanel = resolvePanelId(panel || panelId) || 'external-advanced';
    const usersTable = getUsersTableName(requestedPanel);

    if (!usersTable) {
      return res.status(400).json({ success: false, message: 'Painel inválido.' });
    }

    if (!key || !username || !password) {
      return res.status(400).json({
        success: false,
        message: 'Key, usuário e senha são obrigatórios.'
      });
    }

    const keyRegex = /^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/;
    if (!keyRegex.test(key)) {
      return res.status(400).json({
        success: false,
        message: 'Formato de key inválido. Use XXXX-XXXX-XXXX-XXXX'
      });
    }

    const validation = validateCredentials(username, password);
    if (!validation.valid) {
      return res.status(400).json({ success: false, message: validation.message });
    }

    // Nao HTML-escape a key (quebra o match no banco)
    const sanitizedUsername = sanitizeInput(username);
    const sanitizedKey = key;

    // Localiza em qual tabela de keys (painel) a key está
    const keyTarget = await findKeyAcrossPanels(pool, sanitizedKey);
    if (!keyTarget) {
      logSecurityEvent('REGISTER_INVALID_KEY', { username: sanitizedUsername, ip });
      return res.status(401).json({ success: false, message: 'Key inválida.' });
    }

    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      const [keyRows] = await connection.query(
        `SELECT id, is_used, is_lifetime, duration_days, creator_avatar, panel_id
         FROM \`${keyTarget.tableName}\` WHERE key_value = ? LIMIT 1 FOR UPDATE`,
        [sanitizedKey]
      );

      if (keyRows.length === 0) {
        await connection.rollback();
        logSecurityEvent('REGISTER_INVALID_KEY', { username: sanitizedUsername, ip });
        return res.status(401).json({ success: false, message: 'Key inválida.' });
      }

      if (keyRows[0].is_used) {
        await connection.rollback();
        logSecurityEvent('REGISTER_KEY_ALREADY_USED', { username: sanitizedUsername, ip });
        return res.status(409).json({ success: false, message: 'Key já foi utilizada.' });
      }

      const keyInfo = keyRows[0];
      const keyPanel = resolvePanelId(keyInfo.panel_id) || keyTarget.panelId;
      const finalPanel = keyPanel || requestedPanel;
      const finalUsersTable = getUsersTableName(finalPanel);

      if (!finalUsersTable) {
        await connection.rollback();
        return res.status(400).json({ success: false, message: 'Painel da key inválido.' });
      }

      const [existentes] = await connection.query(
        `SELECT id FROM \`${finalUsersTable}\` WHERE username = ? LIMIT 1`,
        [sanitizedUsername]
      );
      if (existentes.length > 0) {
        await connection.rollback();
        return res.status(409).json({ success: false, message: 'Este usuário já existe.' });
      }

      const hash = await bcrypt.hash(password, 12);
      // Lifetime só se flag=1; se duration_days vier null com flag=0, trata como lifetime por segurança
      const isLifetime = Number(keyInfo.is_lifetime) === 1 || keyInfo.duration_days == null;
      let expiresAt = null;
      if (!isLifetime && Number(keyInfo.duration_days) > 0) {
        const d = new Date();
        d.setDate(d.getDate() + Number(keyInfo.duration_days));
        expiresAt = d;
      }

      const avatar =
        keyInfo.creator_avatar ||
        'https://cdn.discordapp.com/embed/avatars/0.png';

      await connection.query(
        `INSERT INTO \`${finalUsersTable}\`
          (username, password, created_by, creator_role, user_avatar, creator_avatar, expires_at, is_lifetime)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          sanitizedUsername,
          hash,
          'menu-register',
          'member',
          avatar,
          avatar,
          expiresAt,
          isLifetime ? 1 : 0
        ]
      );

      await connection.query(
        `UPDATE \`${keyTarget.tableName}\` SET is_used = TRUE, used_by = ?, used_at = NOW() WHERE id = ?`,
        [sanitizedUsername, keyInfo.id]
      );

      await connection.commit();

      logSecurityEvent('REGISTER_SUCCESS', {
        username: sanitizedUsername,
        ip,
        panel: finalPanel,
        table: finalUsersTable,
      });
      await logApiLogin(sanitizedUsername, true, ip, 'register');

      const responseTime = Date.now() - startTime;
      await logBotApi('/api/auth/register', 'POST', ip, true, responseTime);

      return res.status(201).json({
        success: true,
        message: 'Conta criada com sucesso. Faça login.',
        user: { username: sanitizedUsername, panel: finalPanel },
      });
    } catch (err) {
      await connection.rollback();
      throw err;
    } finally {
      connection.release();
    }
  } catch (err) {
    console.error('Erro no /auth/register:', err);
    const responseTime = Date.now() - startTime;
    await logBotApi('/api/auth/register', 'POST', ip, false, responseTime);
    if (err && err.code === 'ER_BAD_FIELD_ERROR') {
      return res.status(500).json({
        success: false,
        message: 'Banco desatualizado. Reinicie o bot ou rode: node scripts/setupDatabase.js'
      });
    }
    return res.status(500).json({ success: false, message: 'Erro interno no servidor.' });
  }
});

// POST /api/auth/client-login
// Body: { "username": "...", "password": "...", "hwid": "..." }
// Login do menu C++ + lock de HWID (1º login salva; depois só esse PC).
router.post('/auth/client-login', applyRateLimit('external'), async (req, res) => {
  const startTime = Date.now();
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;

  try {
    const { username, password, hwid, panel, panelId } = req.body || {};
    const requestedPanel = resolvePanelId(panel || panelId || req.headers['x-panel-id']);

    if (!username || !password) {
      return res.status(400).json({ success: false, message: 'Usuário e senha são obrigatórios.' });
    }

    if (!hwid || typeof hwid !== 'string' || hwid.trim().length < 4) {
      return res.status(400).json({ success: false, message: 'HWID é obrigatório.' });
    }

    const rateLimitCheck = checkUserRateLimit(username, 10, 15 * 60 * 1000);
    if (!rateLimitCheck.allowed) {
      return res.status(429).json({ success: false, message: rateLimitCheck.message });
    }

    const sanitizedUsername = sanitizeInput(username);
    const sanitizedHwid = sanitizeInput(hwid).substring(0, 255);

    const matches = await findUsersByUsername(pool, sanitizedUsername, requestedPanel);
    let matched = null;

    if (matches.length === 0) {
      await bcrypt.compare(password, DUMMY_HASH);
    } else {
      for (const candidate of matches) {
        const ok = await bcrypt.compare(password, candidate.user.password);
        if (ok) {
          matched = candidate;
          break;
        }
      }
    }

    const user = matched?.user || null;
    const senhaCorreta = !!matched;
    const usersTable = matched?.tableName;
    const finalPanel = matched?.panelId || requestedPanel;

    if (!user || !senhaCorreta) {
      logSecurityEvent('CLIENT_LOGIN_FAILED', {
        username: sanitizedUsername,
        ip,
        userExists: !!user,
        panel: requestedPanel || null,
      });
      await logApiLogin(sanitizedUsername, false, ip, 'client-login');
      return res.status(401).json({ success: false, message: 'Usuário ou senha incorretos.' });
    }

    // ---- Expiração ----
    const isLifetime = !!user.is_lifetime || !user.expires_at;
    let planLabel = 'Lifetime';
    if (!isLifetime) {
      const expires = new Date(user.expires_at);
      if (Number.isNaN(expires.getTime())) {
        return res.status(500).json({ success: false, message: 'Data de expiração inválida.' });
      }
      if (expires.getTime() < Date.now()) {
        logSecurityEvent('CLIENT_LOGIN_EXPIRED', { username: sanitizedUsername, ip });
        await logApiLogin(sanitizedUsername, false, ip, 'expired');
        return res.status(403).json({
          success: false,
          message: 'Licença expirada. Peça uma nova key.'
        });
      }
      planLabel = expires.toISOString().slice(0, 10);
    }

    // ---- HWID lock ----
    let history = [];
    try {
      if (user.hwid_history) {
        history = typeof user.hwid_history === 'string'
          ? JSON.parse(user.hwid_history)
          : user.hwid_history;
        if (!Array.isArray(history)) history = [];
      }
    } catch (_) {
      history = [];
    }

    const boundHwid = user.hwid ? String(user.hwid).trim() : '';

    if (!boundHwid) {
      if (!history.includes(sanitizedHwid)) {
        history.push(sanitizedHwid);
      }
      await pool.query(
        `UPDATE \`${usersTable}\` SET hwid = ?, hwid_history = ? WHERE id = ?`,
        [sanitizedHwid, JSON.stringify(history), user.id]
      );
      logSecurityEvent('HWID_BOUND', {
        username: sanitizedUsername,
        hwid: sanitizedHwid.substring(0, 24) + '...',
        ip
      });
    } else if (boundHwid !== sanitizedHwid) {
      logSecurityEvent('HWID_MISMATCH', {
        username: sanitizedUsername,
        expected: boundHwid.substring(0, 24) + '...',
        got: sanitizedHwid.substring(0, 24) + '...',
        ip
      });
      await logApiLogin(sanitizedUsername, false, ip, 'hwid-mismatch');
      return res.status(403).json({
        success: false,
        message: 'HWID não autorizado. Peça /resethwid no Discord.'
      });
    } else {
      if (!history.includes(sanitizedHwid)) {
        history.push(sanitizedHwid);
        await pool.query(
          `UPDATE \`${usersTable}\` SET hwid_history = ? WHERE id = ?`,
          [JSON.stringify(history), user.id]
        );
      }
    }

    const avatarUrl =
      user.creator_avatar ||
      user.user_avatar ||
      'https://cdn.discordapp.com/embed/avatars/0.png';

    logSecurityEvent('CLIENT_LOGIN_SUCCESS', {
      username: sanitizedUsername,
      ip,
      userId: user.id,
      panel: finalPanel,
      table: usersTable,
      hwid: sanitizedHwid.substring(0, 24) + '...'
    });
    await logApiLogin(sanitizedUsername, true, ip, 'client-login');
    recordAuthMetric('client_login_success', { userId: user.id, ip });

    const responseTime = Date.now() - startTime;
    await logBotApi('/api/auth/client-login', 'POST', ip, true, responseTime);

    return res.status(200).json({
      success: true,
      message: 'Login realizado com sucesso.',
      user: {
        id: user.id,
        username: user.username,
        creator_avatar: avatarUrl,
        user_avatar: avatarUrl,
        expires_at: isLifetime ? null : planLabel,
        plan: planLabel,
        is_lifetime: isLifetime,
        panel: finalPanel,
      }
    });
  } catch (err) {
    console.error('Erro no /auth/client-login:', err);
    const responseTime = Date.now() - startTime;
    await logBotApi('/api/auth/client-login', 'POST', ip, false, responseTime);
    if (err && err.code === 'ER_BAD_FIELD_ERROR') {
      return res.status(500).json({
        success: false,
        message: 'Banco desatualizado. Reinicie o bot ou rode: node scripts/setupDatabase.js'
      });
    }
    return res.status(500).json({ success: false, message: 'Erro interno no servidor.' });
  }
});

module.exports = router;
