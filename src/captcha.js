// Sistema de CAPTCHA Matemático Simples
// Reduz ataques de brute force sem depender de serviços externos

const crypto = require('crypto');

// Store de CAPTCHAs ativos (em memória)
const captchaStore = new Map();

// Limpa CAPTCHAs expirados a cada 5 minutos
setInterval(() => {
  const now = Date.now();
  let expiredCount = 0;
  
  for (const [captchaId, data] of captchaStore.entries()) {
    if (now - data.timestamp > 5 * 60 * 1000) { // 5 minutos
      captchaStore.delete(captchaId);
      expiredCount++;
    }
  }
  
  if (expiredCount > 0) {
    console.log(`🧹 ${expiredCount} CAPTCHAs expirados removidos`);
  }
}, 60 * 1000);

// Gera um CAPTCHA matemático
function generateCaptcha() {
  const captchaId = crypto.randomBytes(16).toString('hex');
  
  // Gera problema matemático (somente + e - para simplicidade)
  const operators = ['+', '-'];
  const operator = operators[Math.floor(Math.random() * operators.length)];
  
  let num1, num2, answer;
  
  if (operator === '+') {
    num1 = Math.floor(Math.random() * 10) + 1; // 1-10
    num2 = Math.floor(Math.random() * 10) + 1; // 1-10
    answer = num1 + num2;
  } else {
    num1 = Math.floor(Math.random() * 10) + 5; // 5-15
    num2 = Math.floor(Math.random() * 5) + 1; // 1-5
    answer = num1 - num2;
  }
  
  const question = `${num1} ${operator} ${num2} = ?`;
  
  // Armazena o CAPTCHA
  captchaStore.set(captchaId, {
    answer,
    timestamp: Date.now(),
    attempts: 0
  });
  
  return {
    captchaId,
    question,
    expiresAt: Date.now() + 5 * 60 * 1000 // 5 minutos
  };
}

// Valida um CAPTCHA
function validateCaptcha(captchaId, userAnswer) {
  const captcha = captchaStore.get(captchaId);
  
  if (!captcha) {
    return { valid: false, reason: 'CAPTCHA expirado ou inválido' };
  }
  
  // Verifica se expirou
  if (Date.now() - captcha.timestamp > 5 * 60 * 1000) {
    captchaStore.delete(captchaId);
    return { valid: false, reason: 'CAPTCHA expirado' };
  }
  
  // Verifica número de tentativas
  captcha.attempts++;
  if (captcha.attempts > 3) {
    captchaStore.delete(captchaId);
    return { valid: false, reason: 'Muitas tentativas. Gere novo CAPTCHA.' };
  }
  
  // Valida resposta
  if (parseInt(userAnswer) === captcha.answer) {
    captchaStore.delete(captchaId);
    return { valid: true };
  }
  
  return { valid: false, reason: 'Resposta incorreta', attemptsRemaining: 3 - captcha.attempts };
}

// Obtém estatísticas de CAPTCHA
function getCaptchaStats() {
  return {
    active: captchaStore.size,
    totalGenerated: captchaStore.size // Simplificado - em produção usar contador
  };
}

// Invalida um CAPTCHA específico
function invalidateCaptcha(captchaId) {
  return captchaStore.delete(captchaId);
}

// Limpa todos os CAPTCHAs (para admin/debug)
function clearAllCaptchas() {
  const count = captchaStore.size;
  captchaStore.clear();
  console.log(`🧹 ${count} CAPTCHAs limpos`);
  return count;
}

module.exports = {
  generateCaptcha,
  validateCaptcha,
  getCaptchaStats,
  invalidateCaptcha,
  clearAllCaptchas
};