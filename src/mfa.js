// Sistema de MFA/2FA (Multi-Factor Authentication)
// Usa TOTP (Time-based One-Time Password) compatível com Google Authenticator

const crypto = require('crypto');

// Store de secrets MFA por usuário (em produção, usar banco de dados)
const mfaSecrets = new Map();

// Gera um secret aleatório para TOTP
function generateMFASecret(userId) {
  const secret = crypto.randomBytes(20).toString('base32');
  mfaSecrets.set(userId, {
    secret,
    enabled: false,
    backupCodes: generateBackupCodes()
  });
  return secret;
}

// Gera códigos de backup (10 códigos de 8 dígitos)
function generateBackupCodes() {
  const codes = [];
  for (let i = 0; i < 10; i++) {
    codes.push(crypto.randomBytes(4).toString('hex').toUpperCase());
  }
  return codes;
}

// Habilita MFA para um usuário
function enableMFA(userId, secret) {
  if (mfaSecrets.has(userId)) {
    mfaSecrets.get(userId).enabled = true;
    return true;
  }
  return false;
}

// Desabilita MFA para um usuário
function disableMFA(userId) {
  if (mfaSecrets.has(userId)) {
    mfaSecrets.get(userId).enabled = false;
    return true;
  }
  return false;
}

// Verifica se MFA está habilitado para um usuário
function isMFAEnabled(userId) {
  const mfaData = mfaSecrets.get(userId);
  return mfaData && mfaData.enabled;
}

// Valida um código TOTP (implementação simplificada)
function validateTOTP(userId, token) {
  const mfaData = mfaSecrets.get(userId);
  if (!mfaData || !mfaData.enabled) {
    return { valid: false, reason: 'MFA não habilitado' };
  }
  
  // Em produção, usar uma biblioteca como 'otplib' para validação real
  // Esta é uma implementação simplificada para demonstração
  const expectedToken = generateSimpleTOTP(mfaData.secret);
  
  // Permite token atual e +/- 1 janela de tempo (30 segundos)
  const validTokens = [
    expectedToken,
    generateSimpleTOTP(mfaData.secret, -1),
    generateSimpleTOTP(mfaData.secret, 1)
  ];
  
  if (validTokens.includes(token)) {
    return { valid: true };
  }
  
  return { valid: false, reason: 'Código inválido' };
}

// Valida um código de backup
function validateBackupCode(userId, code) {
  const mfaData = mfaSecrets.get(userId);
  if (!mfaData || !mfaData.enabled) {
    return { valid: false, reason: 'MFA não habilitado' };
  }
  
  const codeIndex = mfaData.backupCodes.indexOf(code);
  if (codeIndex > -1) {
    // Remove código usado
    mfaData.backupCodes.splice(codeIndex, 1);
    return { valid: true, codesRemaining: mfaData.backupCodes.length };
  }
  
  return { valid: false, reason: 'Código de backup inválido' };
}

// Gera URL para QR code (compatível com Google Authenticator)
function generateQRCodeURL(userId, secret, issuer = 'Bot-BY') {
  const label = encodeURIComponent(`${issuer}:${userId}`);
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: 'SHA1',
    digits: 6,
    period: 30
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

// Implementação simplificada de TOTP (para demonstração)
// Em produção, usar 'otplib' ou similar
function generateSimpleTOTP(secret, timeOffset = 0) {
  const time = Math.floor(Date.now() / 1000 / 30) + timeOffset;
  const counter = Buffer.alloc(8);
  counter.writeUInt32BE(time, 4);
  
  const hmac = crypto.createHmac('sha1', Buffer.from(secret, 'base32'));
  hmac.update(counter);
  const digest = hmac.digest();
  
  const offset = digest[digest.length - 1] & 0x0f;
  const code = ((digest[offset] & 0x7f) << 24 |
                (digest[offset + 1] & 0xff) << 16 |
                (digest[offset + 2] & 0xff) << 8 |
                (digest[offset + 3] & 0xff)) % 1000000;
  
  return code.toString().padStart(6, '0');
}

// Obtém dados MFA de um usuário
function getMFAData(userId) {
  return mfaSecrets.get(userId);
}

// Remove MFA de um usuário (para testes/cleanup)
function removeMFA(userId) {
  return mfaSecrets.delete(userId);
}

module.exports = {
  generateMFASecret,
  enableMFA,
  disableMFA,
  isMFAEnabled,
  validateTOTP,
  validateBackupCode,
  generateQRCodeURL,
  getMFAData,
  removeMFA
};