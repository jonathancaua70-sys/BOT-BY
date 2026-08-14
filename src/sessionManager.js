const jwt = require('jsonwebtoken');

// Store de sessões ativas (em memória - em produção usar Redis)
const sessionStore = new Map();

// Configurações de sessão
const sessionConfig = {
  maxAge: 12 * 60 * 60 * 1000, // 12 horas
  maxSessionsPerUser: 3, // Máximo de sessões simultâneas por usuário
  sessionTimeoutWarning: 10 * 60 * 1000 // 10 minutos antes de expirar
};

// Limpa sessões expiradas a cada hora
setInterval(() => {
  const now = Date.now();
  let expiredCount = 0;
  
  for (const [sessionId, session] of sessionStore.entries()) {
    if (now - session.createdAt > sessionConfig.maxAge) {
      sessionStore.delete(sessionId);
      expiredCount++;
    }
  }
  
  if (expiredCount > 0) {
    console.log(`🧹 ${expiredCount} sessões expiradas removidas`);
  }
}, 60 * 60 * 1000);

// Cria uma nova sessão
function createSession(user, req) {
  const sessionId = generateSessionId();
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  const userAgent = req.headers['user-agent'] || 'unknown';
  
  const session = {
    sessionId,
    userId: user.id,
    username: user.username,
    ip,
    userAgent,
    createdAt: Date.now(),
    lastActivity: Date.now(),
    deviceInfo: detectDevice(userAgent)
  };
  
  // Verifica limite de sessões por usuário
  const userSessions = getUserSessions(user.id);
  if (userSessions.length >= sessionConfig.maxSessionsPerUser) {
    // Remove a sessão mais antiga
    const oldestSession = userSessions.sort((a, b) => a.createdAt - b.createdAt)[0];
    sessionStore.delete(oldestSession.sessionId);
    console.log(`🔄 Sessão antiga removida para usuário ${user.username} (limite de ${sessionConfig.maxSessionsPerUser} sessões)`);
  }
  
  sessionStore.set(sessionId, session);
  
  // Gera JWT token
  const token = jwt.sign(
    { 
      sessionId, 
      userId: user.id, 
      username: user.username 
    },
    process.env.JWT_SECRET,
    { expiresIn: '12h' }
  );
  
  return { token, sessionId, session };
}

// Obtém uma sessão pelo ID
function getSession(sessionId) {
  const session = sessionStore.get(sessionId);
  
  if (!session) {
    return null;
  }
  
  // Verifica se expirou
  if (Date.now() - session.createdAt > sessionConfig.maxAge) {
    sessionStore.delete(sessionId);
    return null;
  }
  
  // Atualiza última atividade
  session.lastActivity = Date.now();
  sessionStore.set(sessionId, session);
  
  return session;
}

// Obtém todas as sessões de um usuário
function getUserSessions(userId) {
  const sessions = [];
  
  for (const [sessionId, session] of sessionStore.entries()) {
    if (session.userId === userId) {
      sessions.push(session);
    }
  }
  
  return sessions.sort((a, b) => b.lastActivity - a.lastActivity);
}

// Invalida uma sessão específica
function invalidateSession(sessionId) {
  const session = sessionStore.get(sessionId);
  if (session) {
    sessionStore.delete(sessionId);
    console.log(`🚪 Sessão invalidada: ${sessionId} (usuário: ${session.username})`);
    return true;
  }
  return false;
}

// Invalida todas as sessões de um usuário
function invalidateUserSessions(userId) {
  let count = 0;
  
  for (const [sessionId, session] of sessionStore.entries()) {
    if (session.userId === userId) {
      sessionStore.delete(sessionId);
      count++;
    }
  }
  
  console.log(`🚪 ${count} sessões invalidadas para usuário ID: ${userId}`);
  return count;
}

// Invalida todas as sessões
function invalidateAllSessions() {
  const count = sessionStore.size;
  sessionStore.clear();
  console.log(`🚪 ${count} sessões invalidadas (total)`);
  return count;
}

// Gera um ID de sessão único
function generateSessionId() {
  return require('crypto').randomBytes(32).toString('hex');
}

// Detecta informações do dispositivo
function detectDevice(userAgent) {
  const device = {
    type: 'unknown',
    os: 'unknown',
    browser: 'unknown'
  };
  
  // Detecta tipo de dispositivo
  if (/mobile/i.test(userAgent)) {
    device.type = 'mobile';
  } else if (/tablet/i.test(userAgent)) {
    device.type = 'tablet';
  } else if (/desktop/i.test(userAgent)) {
    device.type = 'desktop';
  }
  
  // Detecta sistema operacional
  if (/windows/i.test(userAgent)) {
    device.os = 'Windows';
  } else if (/mac os x/i.test(userAgent)) {
    device.os = 'macOS';
  } else if (/linux/i.test(userAgent)) {
    device.os = 'Linux';
  } else if (/android/i.test(userAgent)) {
    device.os = 'Android';
  } else if (/ios/i.test(userAgent)) {
    device.os = 'iOS';
  }
  
  // Detecta navegador
  if (/chrome/i.test(userAgent)) {
    device.browser = 'Chrome';
  } else if (/firefox/i.test(userAgent)) {
    device.browser = 'Firefox';
  } else if (/safari/i.test(userAgent)) {
    device.browser = 'Safari';
  } else if (/edge/i.test(userAgent)) {
    device.browser = 'Edge';
  }
  
  return device;
}

// Verifica se uma sessão está prestes a expirar
function isSessionExpiringSoon(sessionId) {
  const session = sessionStore.get(sessionId);
  if (!session) return false;
  
  const timeUntilExpiry = sessionConfig.maxAge - (Date.now() - session.createdAt);
  return timeUntilExpiry < sessionConfig.sessionTimeoutWarning;
}

// Obtém estatísticas de sessões
function getSessionStats() {
  const stats = {
    total: sessionStore.size,
    byUser: {},
    byDevice: {},
    byOS: {}
  };
  
  for (const session of sessionStore.values()) {
    // Por usuário
    if (!stats.byUser[session.userId]) {
      stats.byUser[session.userId] = 0;
    }
    stats.byUser[session.userId]++;
    
    // Por dispositivo
    if (!stats.byDevice[session.deviceInfo.type]) {
      stats.byDevice[session.deviceInfo.type] = 0;
    }
    stats.byDevice[session.deviceInfo.type]++;
    
    // Por OS
    if (!stats.byOS[session.deviceInfo.os]) {
      stats.byOS[session.deviceInfo.os] = 0;
    }
    stats.byOS[session.deviceInfo.os]++;
  }
  
  return stats;
}

// Lista todas as sessões ativas (para admin)
function listAllSessions() {
  const sessions = [];
  
  for (const [sessionId, session] of sessionStore.entries()) {
    sessions.push({
      sessionId: sessionId.substring(0, 8) + '...', // Apenas parte do ID por segurança
      username: session.username,
      ip: session.ip,
      device: session.deviceInfo,
      createdAt: new Date(session.createdAt).toISOString(),
      lastActivity: new Date(session.lastActivity).toISOString()
    });
  }
  
  return sessions;
}

// Verifica se há sessões suspeitas (mesmo IP, muitos logins, etc.)
function detectSuspiciousSessions() {
  const ipCounts = {};
  const suspicious = [];
  
  for (const session of sessionStore.values()) {
    // Conta sessões por IP
    if (!ipCounts[session.ip]) {
      ipCounts[session.ip] = 0;
    }
    ipCounts[session.ip]++;
    
    // Verifica IPs com muitas sessões
    if (ipCounts[session.ip] > 5) {
      suspicious.push({
        type: 'many_sessions_from_ip',
        ip: session.ip,
        count: ipCounts[session.ip],
        sessions: getUserSessions(session.userId)
      });
    }
  }
  
  return suspicious;
}

module.exports = {
  sessionConfig,
  createSession,
  getSession,
  getUserSessions,
  invalidateSession,
  invalidateUserSessions,
  invalidateAllSessions,
  isSessionExpiringSoon,
  getSessionStats,
  listAllSessions,
  detectSuspiciousSessions
};