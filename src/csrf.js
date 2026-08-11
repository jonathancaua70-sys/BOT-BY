const crypto = require('crypto');

// Store para CSRF tokens (em memória - em produção usar Redis)
const csrfStore = new Map();

// Limpa tokens antigos a cada hora
setInterval(() => {
  const now = Date.now();
  for (const [token, data] of csrfStore.entries()) {
    if (now - data.timestamp > 60 * 60 * 1000) { // 1 hora
      csrfStore.delete(token);
    }
  }
}, 60 * 60 * 1000);

// Gera um novo CSRF token
function generateCSRFToken() {
  const token = crypto.randomBytes(32).toString('hex');
  csrfStore.set(token, {
    timestamp: Date.now(),
    used: false
  });
  return token;
}

// Valida um CSRF token
function validateCSRFToken(token) {
  if (!token) return false;
  
  const data = csrfStore.get(token);
  if (!data) return false;
  
  // Verifica se o token expirou (1 hora)
  if (Date.now() - data.timestamp > 60 * 60 * 1000) {
    csrfStore.delete(token);
    return false;
  }
  
  // Verifica se o token já foi usado (prevenção de replay)
  if (data.used) {
    csrfStore.delete(token);
    return false;
  }
  
  // Marca como usado
  data.used = true;
  csrfStore.set(token, data);
  
  return true;
}

// Invalida um CSRF token específico
function invalidateCSRFToken(token) {
  csrfStore.delete(token);
}

// Invalida todos os tokens de um usuário
function invalidateAllCSRFTokens() {
  csrfStore.clear();
}

// Middleware para injetar CSRF token em requisições
function csrfProtection(req, res, next) {
  // Para requisições GET, HEAD, OPTIONS, TRACE - não requer CSRF
  if (['GET', 'HEAD', 'OPTIONS', 'TRACE'].includes(req.method)) {
    return next();
  }
  
  // Requisições autenticadas por API key não precisam de CSRF
  // CSRF protege sessões de navegador (cookies), não chamadas máquina-a-máquina
  if (req.headers['x-api-key']) {
    return next();
  }

  // Endpoints do cliente C++ (menu) — sem cookie/sessão de browser
  const p = req.path || '';
  if (
    p === '/auth/register' ||
    p === '/auth/client-login' ||
    p === '/auth/external' ||
    p === '/validatekey'
  ) {
    return next();
  }
  
  // Para requisições que modificam dados, valida CSRF token
  const token = req.headers['x-csrf-token'] || req.body?.csrfToken;
  
  if (!token) {
    return res.status(403).json({ 
      success: false, 
      message: 'CSRF token ausente. Acesso negado.' 
    });
  }
  
  if (!validateCSRFToken(token)) {
    return res.status(403).json({ 
      success: false, 
      message: 'CSRF token inválido ou expirado. Acesso negado.' 
    });
  }
  
  next();
}

// Middleware para fornecer CSRF token para o frontend
function provideCSRFToken(req, res, next) {
  const token = generateCSRFToken();
  res.setHeader('X-CSRF-Token', token);
  res.locals.csrfToken = token;
  next();
}

module.exports = {
  generateCSRFToken,
  validateCSRFToken,
  invalidateCSRFToken,
  invalidateAllCSRFTokens,
  csrfProtection,
  provideCSRFToken
};
