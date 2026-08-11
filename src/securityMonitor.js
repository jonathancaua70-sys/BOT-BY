// Sistema de Monitoramento de Performance de Segurança

const securityMetrics = {
  // Métricas de autenticação
  auth: {
    successfulLogins: 0,
    failedLogins: 0,
    rateLimitHits: 0,
    suspiciousAttempts: 0,
    uniqueIPs: new Set(),
    uniqueUsers: new Set()
  },
  
  // Métricas de API
  api: {
    totalRequests: 0,
    successfulRequests: 0,
    failedRequests: 0,
    averageResponseTime: 0,
    slowRequests: 0, // > 1 segundo
    blockedRequests: 0
  },
  
  // Métricas de sistema
  system: {
    memoryUsage: [],
    cpuUsage: [],
    activeSessions: 0,
    errors: 0,
    warnings: 0
  },
  
  // Métricas de webhooks
  webhooks: {
    totalSent: 0,
    successfulSent: 0,
    failedSent: 0,
    averageResponseTime: 0
  }
};

// Histórico de métricas (últimas 24 horas)
const metricsHistory = [];

// Função para registrar métrica de autenticação
function recordAuthMetric(type, details = {}) {
  switch (type) {
    case 'login_success':
      securityMetrics.auth.successfulLogins++;
      securityMetrics.auth.uniqueUsers.add(details.userId);
      break;
    case 'login_failed':
      securityMetrics.auth.failedLogins++;
      if (details.reason === 'rate_limit') {
        securityMetrics.auth.rateLimitHits++;
      }
      if (details.reason === 'suspicious') {
        securityMetrics.auth.suspiciousAttempts++;
      }
      break;
    case 'suspicious_activity':
      securityMetrics.auth.suspiciousAttempts++;
      break;
  }
  
  securityMetrics.auth.uniqueIPs.add(details.ip);
}

// Função para registrar métrica de API
function recordAPIMetric(type, responseTime, success = true) {
  securityMetrics.api.totalRequests++;
  
  if (success) {
    securityMetrics.api.successfulRequests++;
  } else {
    securityMetrics.api.failedRequests++;
  }
  
  // Atualiza tempo médio de resposta
  const totalResponseTime = securityMetrics.api.averageResponseTime * (securityMetrics.api.totalRequests - 1) + responseTime;
  securityMetrics.api.averageResponseTime = totalResponseTime / securityMetrics.api.totalRequests;
  
  // Registra requisições lentas
  if (responseTime > 1000) {
    securityMetrics.api.slowRequests++;
  }
}

// Função para registrar métrica de sistema
function recordSystemMetric(type, value) {
  switch (type) {
    case 'memory':
      securityMetrics.system.memoryUsage.push({
        value,
        timestamp: Date.now()
      });
      // Mantém apenas últimos 100 pontos
      if (securityMetrics.system.memoryUsage.length > 100) {
        securityMetrics.system.memoryUsage.shift();
      }
      break;
    case 'error':
      securityMetrics.system.errors++;
      break;
    case 'warning':
      securityMetrics.system.warnings++;
      break;
    case 'session_created':
      securityMetrics.system.activeSessions++;
      break;
    case 'session_destroyed':
      securityMetrics.system.activeSessions = Math.max(0, securityMetrics.system.activeSessions - 1);
      break;
  }
}

// Função para registrar métrica de webhook
function recordWebhookMetric(success, responseTime) {
  securityMetrics.webhooks.totalSent++;
  
  if (success) {
    securityMetrics.webhooks.successfulSent++;
  } else {
    securityMetrics.webhooks.failedSent++;
  }
  
  // Atualiza tempo médio de resposta
  const totalResponseTime = securityMetrics.webhooks.averageResponseTime * (securityMetrics.webhooks.totalSent - 1) + responseTime;
  securityMetrics.webhooks.averageResponseTime = totalResponseTime / securityMetrics.webhooks.totalSent;
}

// Função para obter métricas atuais
function getCurrentMetrics() {
  return {
    auth: {
      ...securityMetrics.auth,
      uniqueIPs: securityMetrics.auth.uniqueIPs.size,
      uniqueUsers: securityMetrics.auth.uniqueUsers.size,
      successRate: securityMetrics.auth.successfulLogins / (securityMetrics.auth.successfulLogins + securityMetrics.auth.failedLogins) || 0
    },
    api: {
      ...securityMetrics.api,
      successRate: securityMetrics.api.successfulRequests / securityMetrics.api.totalRequests || 0,
      slowRequestRate: securityMetrics.api.slowRequests / securityMetrics.api.totalRequests || 0
    },
    system: {
      ...securityMetrics.system,
      currentMemory: process.memoryUsage(),
      uptime: process.uptime()
    },
    webhooks: {
      ...securityMetrics.webhooks,
      successRate: securityMetrics.webhooks.successfulSent / securityMetrics.webhooks.totalSent || 0
    }
  };
}

// Função para detectar anomalias
function detectAnomalies() {
  const anomalies = [];
  const metrics = getCurrentMetrics();
  
  // Taxa de falha de login alta
  if (metrics.auth.successRate < 0.5 && metrics.auth.failedLogins > 10) {
    anomalies.push({
      type: 'high_login_failure_rate',
      severity: 'high',
      message: 'Taxa de falha de login anormalmente alta',
      value: metrics.auth.successRate
    });
  }
  
  // Muitas tentativas de rate limit
  if (metrics.auth.rateLimitHits > 20) {
    anomalies.push({
      type: 'high_rate_limit_hits',
      severity: 'medium',
      message: 'Muitos hits de rate limit detectados',
      value: metrics.auth.rateLimitHits
    });
  }
  
  // Uso de memória alto
  const memoryPercent = metrics.system.currentMemory.heapUsed / metrics.system.currentMemory.heapTotal;
  if (memoryPercent > 0.9) {
    anomalies.push({
      type: 'high_memory_usage',
      severity: 'high',
      message: 'Uso de memória crítico',
      value: memoryPercent
    });
  } else if (memoryPercent > 0.7) {
    anomalies.push({
      type: 'high_memory_usage',
      severity: 'medium',
      message: 'Uso de memória alto',
      value: memoryPercent
    });
  }
  
  // Taxa de erro da API alta
  if (metrics.api.successRate < 0.9 && metrics.api.totalRequests > 100) {
    anomalies.push({
      type: 'high_api_error_rate',
      severity: 'high',
      message: 'Taxa de erro da API alta',
      value: metrics.api.successRate
    });
  }
  
  // Requisições lentas
  if (metrics.api.slowRequestRate > 0.1) {
    anomalies.push({
      type: 'slow_api_responses',
      severity: 'medium',
      message: 'Muitas requisições lentas detectadas',
      value: metrics.api.slowRequestRate
    });
  }
  
  // Falha de webhooks
  if (metrics.webhooks.successRate < 0.8 && metrics.webhooks.totalSent > 10) {
    anomalies.push({
      type: 'webhook_failures',
      severity: 'medium',
      message: 'Alta taxa de falha em webhooks',
      value: metrics.webhooks.successRate
    });
  }
  
  return anomalies;
}

// Função para gerar relatório de segurança
function generateSecurityReport() {
  const metrics = getCurrentMetrics();
  const anomalies = detectAnomalies();
  
  return {
    timestamp: new Date().toISOString(),
    metrics,
    anomalies,
    health: anomalies.filter(a => a.severity === 'high').length === 0 ? 'healthy' : 'degraded',
    recommendations: generateRecommendations(metrics, anomalies)
  };
}

// Função para gerar recomendações
function generateRecommendations(metrics, anomalies) {
  const recommendations = [];
  
  if (metrics.auth.successRate < 0.7) {
    recommendations.push('Considere aumentar o rate limiting para prevenir ataques de força bruta');
  }
  
  if (metrics.api.slowRequestRate > 0.15) {
    recommendations.push('Investigue gargalos de performance na API');
  }
  
  if (metrics.webhooks.successRate < 0.9) {
    recommendations.push('Verifique a configuração dos webhooks do Discord');
  }
  
  if (metrics.system.currentMemory.heapUsed / metrics.system.currentMemory.heapTotal > 0.8) {
    recommendations.push('Considere aumentar a memória disponível ou otimizar o uso de memória');
  }
  
  if (anomalies.length > 0) {
    recommendations.push('Revise as anomalias detectadas e tome ações corretivas');
  }
  
  return recommendations;
}

// Salva métricas no histórico (a cada hora)
setInterval(() => {
  const metrics = getCurrentMetrics();
  metricsHistory.push({
    timestamp: Date.now(),
    metrics
  });
  
  // Mantém apenas últimos 24 horas
  const oneHourAgo = Date.now() - 24 * 60 * 60 * 1000;
  while (metricsHistory.length > 0 && metricsHistory[0].timestamp < oneHourAgo) {
    metricsHistory.shift();
  }
}, 60 * 60 * 1000);

// Limpa métricas antigas a cada 24 horas
setInterval(() => {
  securityMetrics.auth.uniqueIPs.clear();
  securityMetrics.auth.uniqueUsers.clear();
  securityMetrics.auth.successfulLogins = 0;
  securityMetrics.auth.failedLogins = 0;
  securityMetrics.auth.rateLimitHits = 0;
  securityMetrics.auth.suspiciousAttempts = 0;
  
  securityMetrics.api.totalRequests = 0;
  securityMetrics.api.successfulRequests = 0;
  securityMetrics.api.failedRequests = 0;
  securityMetrics.api.slowRequests = 0;
  
  securityMetrics.system.errors = 0;
  securityMetrics.system.warnings = 0;
  
  securityMetrics.webhooks.totalSent = 0;
  securityMetrics.webhooks.successfulSent = 0;
  securityMetrics.webhooks.failedSent = 0;
  
  console.log('🧹 Métricas de segurança resetadas (ciclo diário)');
}, 24 * 60 * 60 * 1000);

module.exports = {
  recordAuthMetric,
  recordAPIMetric,
  recordSystemMetric,
  recordWebhookMetric,
  getCurrentMetrics,
  detectAnomalies,
  generateSecurityReport,
  securityMetrics
};