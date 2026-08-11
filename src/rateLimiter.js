const rateLimit = require('express-rate-limit');

// Configurações de rate limiting por endpoint
const rateLimitConfigs = {
  // Login - muito restrito para prevenir brute force
  login: {
    windowMs: 15 * 60 * 1000, // 15 minutos
    max: 5, // 5 tentativas
    message: { success: false, message: 'Muitas tentativas de login. Tente novamente em 15 minutos.' }
  },
  
  // Validate key - moderado
  validateKey: {
    windowMs: 15 * 60 * 1000, // 15 minutos
    max: 20, // 20 validações
    message: { success: false, message: 'Muitas validações de key. Tente novamente mais tarde.' }
  },
  
  // Status - leve (só para informações)
  status: {
    windowMs: 1 * 60 * 1000, // 1 minuto
    max: 60, // 60 requisições por minuto
    message: { success: false, message: 'Muitas requisições de status. Diminua a frequência.' }
  },
  
  // Backup - muito restrito (requer autenticação)
  backup: {
    windowMs: 60 * 60 * 1000, // 1 hora
    max: 3, // 3 backups por hora
    message: { success: false, message: 'Muitos backups. Tente novamente em 1 hora.' }
  },
  
  // Logs - moderado (requer autenticação)
  logs: {
    windowMs: 1 * 60 * 1000, // 1 minuto
    max: 10, // 10 requisições por minuto
    message: { success: false, message: 'Muitas requisições de logs. Tente novamente mais tarde.' }
  },
  
  // Users - moderado (requer autenticação)
  users: {
    windowMs: 1 * 60 * 1000, // 1 minuto
    max: 30, // 30 requisições por minuto
    message: { success: false, message: 'Muitas requisições de usuários. Tente novamente mais tarde.' }
  },
  
  // Keys - moderado (requer autenticação)
  keys: {
    windowMs: 1 * 60 * 1000, // 1 minuto
    max: 30, // 30 requisições por minuto
    message: { success: false, message: 'Muitas requisições de keys. Tente novamente mais tarde.' }
  },

  // Register via menu C++ (key + user + senha)
  register: {
    windowMs: 15 * 60 * 1000,
    max: 8,
    message: { success: false, message: 'Muitas tentativas de registro. Tente novamente mais tarde.' }
  },

  // Login externo / client (C++ menu)
  external: {
    windowMs: 15 * 60 * 1000,
    max: 10,
    message: { success: false, message: 'Muitas tentativas de login. Tente novamente em 15 minutos.' }
  },
  
  // Geral - para endpoints não especificados
  general: {
    windowMs: 15 * 60 * 1000, // 15 minutos
    max: 100, // 100 requisições
    message: { success: false, message: 'Muitas requisições. Tente novamente mais tarde.' }
  }
};

// Cria rate limiters configurados
const rateLimiters = {};

// Inicializa os rate limiters
Object.keys(rateLimitConfigs).forEach(key => {
  const config = rateLimitConfigs[key];
  rateLimiters[key] = rateLimit({
    windowMs: config.windowMs,
    max: config.max,
    standardHeaders: true,
    legacyHeaders: false,
    message: config.message,
    // Valida pelo IP e por User-Agent para evitar bypass simples
    keyGenerator: (req) => {
      const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
      const userAgent = req.headers['user-agent'] || 'unknown';
      return `${ip}_${userAgent}`;
    },
    // Skip rate limiting para requisições de IPs whitelist
    skip: (req) => {
      const whitelistedIPs = process.env.WHITELISTED_IPS?.split(',') || [];
      const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
      return whitelistedIPs.includes(ip);
    }
  });
});

// Middleware para aplicar rate limiting por endpoint
function applyRateLimit(endpoint) {
  const limiter = rateLimiters[endpoint] || rateLimiters.general;
  return limiter;
}

// Middleware customizado para rate limiting por usuário
function createUserRateLimit(options = {}) {
  const {
    windowMs = 15 * 60 * 1000,
    max = 100,
    keyGenerator = (req) => req.user?.id || req.ip
  } = options;
  
  return rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, message: 'Limite de requisições excedido para este usuário.' },
    keyGenerator,
    skip: (req) => {
      const whitelistedIPs = process.env.WHITELISTED_IPS?.split(',') || [];
      const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
      return whitelistedIPs.includes(ip);
    }
  });
}

// Rate limiting baseado em complexidade da requisição
function createComplexityRateLimit(baseLimit, complexityMultiplier = 1) {
  return rateLimit({
    windowMs: 15 * 60 * 1000,
    max: (req) => {
      const complexity = calculateRequestComplexity(req);
      return Math.floor(baseLimit / (complexity * complexityMultiplier));
    },
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, message: 'Requisição muito complexa. Diminua a frequência.' }
  });
}

// Calcula complexidade da requisição
function calculateRequestComplexity(req) {
  let complexity = 1;
  
  // Tamanho do body
  if (req.body) {
    const bodySize = JSON.stringify(req.body).length;
    complexity += Math.floor(bodySize / 1000); // +1 para cada KB
  }
  
  // Parâmetros de query
  if (req.query && Object.keys(req.query).length > 0) {
    complexity += Object.keys(req.query).length * 0.5;
  }
  
  // Headers adicionais
  if (req.headers && Object.keys(req.headers).length > 10) {
    complexity += (Object.keys(req.headers).length - 10) * 0.1;
  }
  
  return Math.max(1, complexity);
}

// Rate limiting adaptativo baseado em carga do sistema
function createAdaptiveRateLimit(baseLimit = 100) {
  return rateLimit({
    windowMs: 15 * 60 * 1000,
    max: (req) => {
      const memoryUsage = process.memoryUsage();
      const memoryPercent = memoryUsage.heapUsed / memoryUsage.heapTotal;
      
      // Reduz limite se memória estiver alta
      if (memoryPercent > 0.8) {
        return Math.floor(baseLimit * 0.5);
      } else if (memoryPercent > 0.6) {
        return Math.floor(baseLimit * 0.75);
      }
      
      return baseLimit;
    },
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, message: 'Sistema sob alta carga. Tente novamente mais tarde.' }
  });
}

// Exporta tudo
module.exports = {
  rateLimitConfigs,
  rateLimiters,
  applyRateLimit,
  createUserRateLimit,
  createComplexityRateLimit,
  createAdaptiveRateLimit,
  calculateRequestComplexity
};