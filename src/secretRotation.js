// Sistema de Rotação de Secrets
// Permite rotação automática de JWT_SECRET e API_KEY para segurança

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// Configuração
const SECRET_CONFIG = {
  rotationInterval: 30 * 24 * 60 * 60 * 1000, // 30 dias (configurável)
  warningInterval: 7 * 24 * 60 * 60 * 1000, // 7 dias antes de expirar
  secretsFile: path.join(__dirname, '../.secrets.json'),
  secretsBackupFile: path.join(__dirname, '../.secrets.backup.json')
};

// Estrutura de secrets
const secrets = {
  current: {
    JWT_SECRET: null,
    API_KEY: null,
    rotationDate: null,
    expiryDate: null
  },
  previous: {
    JWT_SECRET: null,
    API_KEY: null,
    validUntil: null
  }
};

// Gera um secret aleatório forte
function generateSecret(length = 64) {
  return crypto.randomBytes(length).toString('hex');
}

// Inicializa secrets
function initializeSecrets() {
  try {
    // Tenta carregar secrets existentes
    if (fs.existsSync(SECRET_CONFIG.secretsFile)) {
      const data = JSON.parse(fs.readFileSync(SECRET_CONFIG.secretsFile, 'utf8'));
      secrets.current = data.current;
      secrets.previous = data.previous;
      
      console.log('🔐 Secrets carregados do arquivo .secrets.json');
    } else {
      // Gera novos secrets
      rotateSecrets(true);
    }
  } catch (error) {
    console.error('❌ Erro ao carregar secrets, gerando novos:', error);
    rotateSecrets(true);
  }
}

// Rotaciona os secrets
function rotateSecrets(force = false) {
  const now = Date.now();
  
  // Verifica se precisa rotacionar
  if (!force && secrets.current.expiryDate && now < secrets.current.expiryDate - SECRET_CONFIG.warningInterval) {
    const daysUntilExpiry = Math.ceil((secrets.current.expiryDate - now) / (24 * 60 * 60 * 1000));
    console.log(`🔒 Secrets expiram em ${daysUntilExpiry} dias - rotação não necessária`);
    return false;
  }
  
  console.log('🔄 Rotacionando secrets...');
  
  // Move current para previous
  secrets.previous = {
    ...secrets.current,
    validUntil: secrets.current.expiryDate || (now + 24 * 60 * 60 * 1000) // Previous válido por 24h
  };
  
  // Gera novos secrets
  secrets.current = {
    JWT_SECRET: generateSecret(64),
    API_KEY: generateSecret(64),
    rotationDate: now,
    expiryDate: now + SECRET_CONFIG.rotationInterval
  };
  
  // Salva no arquivo
  saveSecrets();
  
  // Cria backup
  backupSecrets();
  
  console.log('✅ Secrets rotacionados com sucesso');
  console.log(`🔑 Novo JWT_SECRET gerado (primeiros 16 chars): ${secrets.current.JWT_SECRET.substring(0, 16)}...`);
  console.log(`🔑 Nova API_KEY gerada (primeiros 16 chars): ${secrets.current.API_KEY.substring(0, 16)}...`);
  console.log(`📅 Próxima rotação: ${new Date(secrets.current.expiryDate).toISOString()}`);
  
  // Envia alerta via webhook se configurado
  notifySecretRotation();
  
  return true;
}

// Salva secrets no arquivo
function saveSecrets() {
  try {
    fs.writeFileSync(SECRET_CONFIG.secretsFile, JSON.stringify(secrets, null, 2));
    console.log('💾 Secrets salvos em .secrets.json');
  } catch (error) {
    console.error('❌ Erro ao salvar secrets:', error);
  }
}

// Cria backup dos secrets
function backupSecrets() {
  try {
    if (fs.existsSync(SECRET_CONFIG.secretsFile)) {
      fs.copyFileSync(SECRET_CONFIG.secretsFile, SECRET_CONFIG.secretsBackupFile);
      console.log('💾 Backup dos secrets criado em .secrets.backup.json');
    }
  } catch (error) {
    console.error('❌ Erro ao criar backup dos secrets:', error);
  }
}

// Notifica rotação de secrets via webhook
function notifySecretRotation() {
  const webhookUrl = process.env.SECURITY_WEBHOOK_URL;
  if (!webhookUrl) return;
  
  const embed = {
    title: '🔐 Secrets Rotacionados',
    color: 0x3498db,
    fields: [
      { name: '📅 Data', value: new Date().toISOString(), inline: true },
      { name: '⏰ Próxima Rotação', value: new Date(secrets.current.expiryDate).toISOString(), inline: true },
      { name: '⚠️ Ação Necessária', value: 'Atualize as variáveis de ambiente no servidor', inline: false }
    ],
    timestamp: new Date().toISOString()
  };
  
  try {
    fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ embeds: [embed] }),
    });
  } catch (err) {
    console.error('⚠️ Não foi possível enviar notificação de rotação:', err.message);
  }
}

// Obtém o secret atual (com fallback para variáveis de ambiente)
function getSecret(secretName) {
  // Prioridade: secrets file > variáveis de ambiente > gerar novo
  if (secrets.current[secretName]) {
    return secrets.current[secretName];
  }
  
  if (process.env[secretName]) {
    console.log(`⚠️ Usando ${secretName} de variável de ambiente (considere usar sistema de rotação)`);
    return process.env[secretName];
  }
  
  // Gera novo secret se não existir
  console.log(`⚠️ ${secretName} não encontrado, gerando novo secret`);
  const newSecret = generateSecret();
  secrets.current[secretName] = newSecret;
  saveSecrets();
  return newSecret;
}

// Verifica se o secret atual está expirando
function isSecretExpiringSoon() {
  const now = Date.now();
  const expiryDate = secrets.current.expiryDate;
  
  if (!expiryDate) return false;
  
  return now > expiryDate - SECRET_CONFIG.warningInterval;
}

// Valida um secret (permite secrets anteriores durante janela de transição)
function validateSecret(secretName, providedSecret) {
  // Verifica secret atual
  if (secrets.current[secretName] === providedSecret) {
    return { valid: true, version: 'current' };
  }
  
  // Verifica secret anterior (janela de transição)
  if (secrets.previous[secretName] === providedSecret) {
    const now = Date.now();
    if (secrets.previous.validUntil && now < secrets.previous.validUntil) {
      return { valid: true, version: 'previous', expiresAt: new Date(secrets.previous.validUntil).toISOString() };
    }
  }
  
  return { valid: false };
}

// Obtém status dos secrets
function getSecretsStatus() {
  const now = Date.now();
  
  return {
    current: {
      rotationDate: secrets.current.rotationDate ? new Date(secrets.current.rotationDate).toISOString() : null,
      expiryDate: secrets.current.expiryDate ? new Date(secrets.current.expiryDate).toISOString() : null,
      daysUntilExpiry: secrets.current.expiryDate ? Math.ceil((secrets.current.expiryDate - now) / (24 * 60 * 60 * 1000)) : null
    },
    previous: {
      validUntil: secrets.previous.validUntil ? new Date(secrets.previous.validUntil).toISOString() : null,
      valid: secrets.previous.validUntil ? now < secrets.previous.validUntil : false
    },
    needsRotation: isSecretExpiringSoon()
  };
}

// Inicia rotação automática
function startSecretRotation() {
  console.log('🔄 Iniciando sistema de rotação automática de secrets...');
  
  // Rotaciona imediatamente se necessário
  if (isSecretExpiringSoon()) {
    rotateSecrets();
  }
  
  // Agenda próxima rotação
  const now = Date.now();
  const nextRotation = secrets.current.expiryDate || (now + SECRET_CONFIG.rotationInterval);
  const msUntilRotation = nextRotation - now;
  
  console.log(`📅 Próxima rotação agendada para: ${new Date(nextRotation).toISOString()}`);
  
  setTimeout(() => {
    rotateSecrets();
    startSecretRotation(); // Agenda próxima rotação
  }, msUntilRotation);
}

// Força rotação manual
function forceRotation() {
  console.log('⚠️ Forçando rotação manual de secrets...');
  return rotateSecrets(true);
}

// Atualiza variáveis de ambiente do processo (para uso imediato)
function updateProcessEnv() {
  if (secrets.current.JWT_SECRET) {
    process.env.JWT_SECRET = secrets.current.JWT_SECRET;
  }
  if (secrets.current.API_KEY) {
    process.env.API_KEY = secrets.current.API_KEY;
  }
  console.log('🔧 Variáveis de ambiente do processo atualizadas');
}

// Exporta funções
module.exports = {
  initializeSecrets,
  rotateSecrets,
  forceRotation,
  getSecret,
  validateSecret,
  getSecretsStatus,
  isSecretExpiringSoon,
  startSecretRotation,
  updateProcessEnv,
  SECRET_CONFIG
};