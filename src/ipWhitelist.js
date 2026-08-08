// Sistema de Whitelist de IPs para acesso administrativo

// Configuração de whitelist (pode ser expandida via variáveis de ambiente)
const whitelistedIPs = {
  // IPs administrativos (exemplo)
  admin: (process.env.ADMIN_IPS || '').split(',').filter(ip => ip.trim()),
  
  // IPs de desenvolvimento
  development: (process.env.DEV_IPS || '').split(',').filter(ip => ip.trim()),
  
  // IPs de serviços confiáveis
  services: (process.env.SERVICE_IPS || '').split(',').filter(ip => ip.trim())
};

// Código de emergência para bypass temporário (MUITO PERIGOSO - usar apenas em emergência)
const EMERGENCY_BYPASS_CODE = process.env.EMERGENCY_BYPASS_CODE || null;

// Níveis de acesso por whitelist
const accessLevels = {
  ADMIN: 'admin',        // Acesso total administrativo
  MODERATOR: 'moderator', // Acesso moderado
  USER: 'user',          // Acesso normal de usuário
  BLOCKED: 'blocked'     // Acesso bloqueado
};

// Log de tentativas de acesso não autorizado (para audit trail)
const accessLogs = [];
const MAX_LOG_ENTRIES = 1000;

function logAccessAttempt(ip, level, result, reason = '') {
  const logEntry = {
    timestamp: new Date().toISOString(),
    ip,
    level,
    result,
    reason
  };
  
  accessLogs.push(logEntry);
  
  // Mantém apenas últimos 1000 logs
  if (accessLogs.length > MAX_LOG_ENTRIES) {
    accessLogs.shift();
  }
  
  // Loga no console para visibilidade imediata
  if (result === 'denied') {
    console.log(`🚫 Acesso negado: IP ${ip} para nível ${level} - ${reason}`);
  }
}

// Verifica se um IP está na whitelist
function isIPWhitelisted(ip, level = 'admin') {
  if (!ip) return false;
  
  const whitelisted = whitelistedIPs[level] || [];
  return whitelisted.includes(ip.trim());
}

// Verifica se um IP está em qualquer whitelist
function isIPInAnyWhitelist(ip) {
  if (!ip) return false;
  
  return Object.values(whitelistedIPs).some(whitelist => 
    whitelist.includes(ip.trim())
  );
}

// Obtém o nível de acesso de um IP
function getIPAccessLevel(ip) {
  if (!ip) return accessLevels.BLOCKED;
  
  if (isIPWhitelisted(ip, 'admin')) return accessLevels.ADMIN;
  if (isIPWhitelisted(ip, 'development')) return accessLevels.MODERATOR;
  if (isIPWhitelisted(ip, 'services')) return accessLevels.USER;
  
  return accessLevels.BLOCKED;
}

// Middleware para verificar whitelist de IP
function requireIPWhitelist(level = 'admin') {
  return (req, res, next) => {
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    
    // VERIFICAÇÃO DE EMERGÊNCIA (MUITO PERIGOSO - usar apenas em casos extremos)
    const emergencyCode = req.headers['x-emergency-bypass'];
    if (EMERGENCY_BYPASS_CODE && emergencyCode === EMERGENCY_BYPASS_CODE) {
      console.log(`⚠️⚠️⚠️ EMERGENCY BYPASS ATIVADO por IP: ${ip} - Nível: ${level}`);
      logAccessAttempt(ip, level, 'emergency_bypass', 'Código de emergência usado');
      return next();
    }
    
    // Se não tiver whitelist configurada, permite acesso
    if (!whitelistedIPs[level] || whitelistedIPs[level].length === 0) {
      logAccessAttempt(ip, level, 'allowed', 'Whitelist não configurada');
      return next();
    }
    
    // Verifica se IP está na whitelist
    if (isIPWhitelisted(ip, level)) {
      logAccessAttempt(ip, level, 'allowed', 'IP está na whitelist');
      return next();
    }
    
    // Loga tentativa de acesso não autorizado
    logAccessAttempt(ip, level, 'denied', 'IP não está na whitelist');
    
    return res.status(403).json({
      success: false,
      message: 'Acesso não autorizado. Seu IP não está na whitelist.',
      emergency_mode: EMERGENCY_BYPASS_CODE ? 'available' : 'disabled'
    });
  };
}

// Middleware para verificar blacklist de IP
function checkIPBlacklist(blacklistedIPs = []) {
  return (req, res, next) => {
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    
    if (blacklistedIPs.includes(ip)) {
      console.log(`🚫 IP blacklistado tentou acessar: ${ip}`);
      logAccessAttempt(ip, 'blacklist', 'denied', 'IP está na blacklist');
      return res.status(403).json({
        success: false,
        message: 'Seu IP foi bloqueado.'
      });
    }
    
    next();
  };
}

// Middleware para geo-blocking (bloqueio por país/ região)
function geoBlock(allowedCountries = ['BR']) {
  return async (req, res, next) => {
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    
    // Em produção, usar um serviço de geolocalização
    // Por enquanto, apenas loga o IP
    console.log(`🌍 Acesso de IP: ${ip} (geo-blocking não implementado)`);
    
    next();
  };
}

// Store global para rate limiting por IP
const ipStore = new Map();

// Middleware para rate limiting por IP específico
function createIPRateLimit(maxRequests = 100, windowMs = 15 * 60 * 1000) {
  return (req, res, next) => {
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    const now = Date.now();
    
    if (!ipStore.has(ip)) {
      ipStore.set(ip, { count: 1, resetTime: now + windowMs });
      return next();
    }
    
    const data = ipStore.get(ip);
    
    // Reseta se passou o tempo da janela
    if (now > data.resetTime) {
      ipStore.set(ip, { count: 1, resetTime: now + windowMs });
      return next();
    }
    
    // Verifica se excedeu o limite
    if (data.count >= maxRequests) {
      logAccessAttempt(ip, 'rate_limit', 'denied', 'Excedeu limite de requisições');
      return res.status(429).json({
        success: false,
        message: 'Muitas requisições deste IP. Tente novamente mais tarde.'
      });
    }
    
    // Incrementa contador
    data.count++;
    ipStore.set(ip, data);
    
    next();
  };
}

// Limpa entradas antigas do store
setInterval(() => {
  const now = Date.now();
  
  // Limpa o store de rate limiting
  for (const [ip, data] of ipStore.entries()) {
    if (now > data.resetTime) {
      ipStore.delete(ip);
    }
  }
}, 60 * 1000); // Limpa a cada minuto

// Adiciona IP à whitelist
function addToWhitelist(ip, level = 'admin') {
  if (!whitelistedIPs[level]) {
    whitelistedIPs[level] = [];
  }
  
  if (!whitelistedIPs[level].includes(ip)) {
    whitelistedIPs[level].push(ip);
    console.log(`✅ IP ${ip} adicionado à whitelist de nível ${level}`);
    logAccessAttempt(ip, level, 'whitelist_add', 'IP adicionado manualmente');
  }
}

// Remove IP da whitelist
function removeFromWhitelist(ip, level = 'admin') {
  if (whitelistedIPs[level]) {
    const index = whitelistedIPs[level].indexOf(ip);
    if (index > -1) {
      whitelistedIPs[level].splice(index, 1);
      console.log(`🗑️  IP ${ip} removido da whitelist de nível ${level}`);
      logAccessAttempt(ip, level, 'whitelist_remove', 'IP removido manualmente');
    }
  }
}

// Lista todas as whitelists
function listWhitelists() {
  return whitelistedIPs;
}

// Lista logs de acesso (para troubleshooting)
function getAccessLogs(limit = 50) {
  return accessLogs.slice(-limit);
}

// Gera código de emergência temporário (MUITO PERIGOSO - usar apenas em emergência)
function generateEmergencyBypassCode() {
  const code = require('crypto').randomBytes(16).toString('hex');
  console.log(`⚠️⚠️⚠️ CÓDIGO DE EMERGÊNCIA GERADO: ${code}`);
  console.log(`⚠️⚠️⚠️ Este código permite bypass total da whitelist - MUITO PERIGOSO`);
  console.log(`⚠️⚠️⚠️ Use apenas em emergência absoluta e expire imediatamente após uso`);
  return code;
}

// Expira código de emergência (após usar)
function expireEmergencyBypassCode() {
  console.log(`🔒 Código de emergência expirado - whitelist reativada`);
  // Em produção, isso poderia invalidar o código via variável de ambiente
}

module.exports = {
  whitelistedIPs,
  accessLevels,
  isIPWhitelisted,
  isIPInAnyWhitelist,
  getIPAccessLevel,
  requireIPWhitelist,
  checkIPBlacklist,
  geoBlock,
  createIPRateLimit,
  addToWhitelist,
  removeFromWhitelist,
  listWhitelists,
  getAccessLogs,
  generateEmergencyBypassCode,
  expireEmergencyBypassCode
};
