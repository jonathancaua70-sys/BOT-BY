// Sistema centralizado de webhooks para logs
const WEBHOOKS = {
  // Acessos ao site
  SITE_ACCESS: process.env.WEBHOOK_SITE_ACCESS || 'https://discord.com/api/webhooks/1535636600216617050/9O2VfmFX4mR4uP8YZDcHmTZe78jT-wBTmTZPaX2WBG5BiOhtISh1oFxJrpDaognO5fC1',
  
  // Login
  LOGIN: process.env.WEBHOOK_LOGIN || 'https://discord.com/api/webhooks/1535636767816945744/-kT19g2gQ2ltKCKE9JhDQIqSE7nVYRemmAip7VQKNc_8Lg1dVJmp1NKX3k0Jj-eRi3l2',
  
  // Tentativas de ataque/DDoS
  ATTACK_ATTEMPTS: process.env.WEBHOOK_ATTACK_ATTEMPTS || 'https://discord.com/api/webhooks/1535636815615098911/NeSaZCUCsE9SClrV4Fp5jJoW_GSEKB-p-14QqWCq6zgQhZCnf0bSKlBErwXgABSym6fJ',
  
  // Comandos do bot
  BOT_COMMANDS: process.env.WEBHOOK_BOT_COMMANDS || 'https://discord.com/api/webhooks/1535636912469970995/9KTVV5JbXCXtgpj70LgsrGqDS8jAbCmtXiRKlhHOXpJhwTUucSJ7DKyCdgv-fmuNPPWQ',
  
  // API do bot
  BOT_API: process.env.WEBHOOK_BOT_API || 'https://discord.com/api/webhooks/1535636962512343194/AVSe-RTNBrJgiMGPwsZNOzSb6ru4Gxn77PxJaplElW_mMqtqfPpqyOpC42JxKyqhQW9E',
  
  // Status do sistema
  SYSTEM_STATUS: process.env.WEBHOOK_SYSTEM_STATUS || 'https://discord.com/api/webhooks/1535637008565674085/TdW7mBZkv85cLZ3pYAnw_n3VrkCyKoVp0gUxyGP_CbOSPf9-yUgPqcTW4oSx-TCvK2Gd',
  
  // Erros do sistema
  SYSTEM_ERRORS: process.env.WEBHOOK_SYSTEM_ERRORS || 'https://discord.com/api/webhooks/1535637105378861127/Snc5cTh0oHqYD2KT8Y2kZLyi1iA9VwPKji911glShEN2ChfYNVgtny5m7shMdhyqJest',
  
  // Login da API (C++/C#)
  API_LOGIN: process.env.WEBHOOK_API_LOGIN || 'https://discord.com/api/webhooks/1535637224140312601/Y58BVvHnQ81JJGHaM81PVeQ7-7O9lzjROAy7xFit1VViQVBdI-tjmilsniD7ZFDwAMpf'
};

// Cores para embeds
const COLORS = {
  SUCCESS: 0x2ecc71,      // Verde
  ERROR: 0xe74c3c,         // Vermelho
  WARNING: 0xf39c12,       // Amarelo
  INFO: 0x3498db,          // Azul
  CRITICAL: 0x9b59b6,      // Roxo
  ATTACK: 0xff0000         // Vermelho claro
};

// Função genérica para enviar webhook
async function sendWebhook(webhookUrl, embed) {
  try {
    await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ embeds: [embed] }),
    });
  } catch (err) {
    console.error('❌ Erro ao enviar webhook:', err.message);
  }
}

// Log de acesso ao site
async function logSiteAccess(req, path) {
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  const userAgent = req.headers['user-agent'] || 'Desconhecido';
  const timestamp = new Date().toISOString();
  
  const embed = {
    title: '🌐 Acesso ao Site',
    color: COLORS.INFO,
    fields: [
      { name: '📍 Caminho', value: path, inline: true },
      { name: '🌐 IP', value: ip || 'Desconhecido', inline: true },
      { name: '🖥️ User Agent', value: userAgent.substring(0, 100), inline: false },
      { name: '⏰ Timestamp', value: timestamp, inline: true },
    ],
    timestamp,
  };
  
  await sendWebhook(WEBHOOKS.SITE_ACCESS, embed);
}

// Log de login
async function logLogin(username, success, ip, reason = '') {
  const timestamp = new Date().toISOString();
  const embed = {
    title: success ? '✅ Login Realizado' : '❌ Tentativa de Login',
    color: success ? COLORS.SUCCESS : COLORS.ERROR,
    fields: [
      { name: '👤 Usuário', value: username || 'Desconhecido', inline: true },
      { name: '🌐 IP', value: ip || 'Desconhecido', inline: true },
      { name: '⏰ Timestamp', value: timestamp, inline: true },
    ],
    timestamp,
  };
  
  if (!success && reason) {
    embed.fields.push({ name: '❌ Motivo', value: reason, inline: false });
  }
  
  await sendWebhook(WEBHOOKS.LOGIN, embed);
}

// Log de tentativa de ataque
async function logAttack(type, ip, details = {}) {
  const timestamp = new Date().toISOString();
  const embed = {
    title: '🚨 Tentativa de Ataque Detectada',
    color: COLORS.ATTACK,
    fields: [
      { name: '⚡ Tipo', value: type, inline: true },
      { name: '🌐 IP', value: ip || 'Desconhecido', inline: true },
      { name: '⏰ Timestamp', value: timestamp, inline: true },
    ],
    timestamp,
  };
  
  // Adiciona detalhes específicos
  if (Object.keys(details).length > 0) {
    const detailsText = Object.entries(details)
      .map(([key, value]) => `${key}: ${value}`)
      .join('\n');
    embed.fields.push({ name: '📋 Detalhes', value: detailsText, inline: false });
  }
  
  await sendWebhook(WEBHOOKS.ATTACK_ATTEMPTS, embed);
}

// Log de comando do bot
async function logBotCommand(command, user, guild, success = true, details = '') {
  const timestamp = new Date().toISOString();
  const embed = {
    title: success ? '🤖 Comando Executado' : '❌ Comando Falhou',
    color: success ? COLORS.SUCCESS : COLORS.ERROR,
    fields: [
      { name: '📝 Comando', value: command, inline: true },
      { name: '👤 Usuário', value: user, inline: true },
      { name: '🏢 Servidor', value: guild || 'DM', inline: true },
      { name: '⏰ Timestamp', value: timestamp, inline: true },
    ],
    timestamp,
  };
  
  if (details) {
    embed.fields.push({ name: '📋 Detalhes', value: details, inline: false });
  }
  
  await sendWebhook(WEBHOOKS.BOT_COMMANDS, embed);
}

// Log de API do bot
async function logBotApi(endpoint, method, ip, success = true, responseTime = 0) {
  const timestamp = new Date().toISOString();
  const embed = {
    title: success ? '📡 API Bot Acessada' : '❌ API Bot Falhou',
    color: success ? COLORS.SUCCESS : COLORS.ERROR,
    fields: [
      { name: '🔗 Endpoint', value: endpoint, inline: true },
      { name: '📡 Método', value: method, inline: true },
      { name: '🌐 IP', value: ip || 'Desconhecido', inline: true },
      { name: '⏱️ Tempo de Resposta', value: `${responseTime}ms`, inline: true },
      { name: '⏰ Timestamp', value: timestamp, inline: true },
    ],
    timestamp,
  };
  
  await sendWebhook(WEBHOOKS.BOT_API, embed);
}

// Log de status do sistema
async function logSystemStatus(components) {
  const timestamp = new Date().toISOString();
  const embed = {
    title: '📊 Status do Sistema',
    color: COLORS.INFO,
    fields: [
      { name: '🗄️ Banco de Dados', value: components.database || 'Desconhecido', inline: true },
      { name: '🤖 Bot Discord', value: components.bot || 'Desconhecido', inline: true },
      { name: '🌐 API', value: components.api || 'Desconhecido', inline: true },
      { name: '⏰ Timestamp', value: timestamp, inline: true },
    ],
    timestamp,
  };
  
  await sendWebhook(WEBHOOKS.SYSTEM_STATUS, embed);
}

// Log de erro do sistema
async function logSystemError(error, context = {}) {
  const timestamp = new Date().toISOString();
  const embed = {
    title: '💥 Erro do Sistema',
    color: COLORS.ERROR,
    fields: [
      { name: '❌ Erro', value: error.message || error, inline: false },
      { name: '📋 Contexto', value: JSON.stringify(context), inline: false },
      { name: '⏰ Timestamp', value: timestamp, inline: true },
    ],
    timestamp,
  };
  
  await sendWebhook(WEBHOOKS.SYSTEM_ERRORS, embed);
}

// Log de login da API (C++/C#)
async function logApiLogin(username, success, ip, method = 'Desconhecido') {
  const timestamp = new Date().toISOString();
  const embed = {
    title: success ? '🔑 Login API (C++/C#)' : '❌ Falha Login API (C++/C#)',
    color: success ? COLORS.SUCCESS : COLORS.ERROR,
    fields: [
      { name: '👤 Usuário', value: username || 'Desconhecido', inline: true },
      { name: '🌐 IP', value: ip || 'Desconhecido', inline: true },
      { name: '💻 Método', value: method, inline: true },
      { name: '⏰ Timestamp', value: timestamp, inline: true },
    ],
    timestamp,
  };
  
  await sendWebhook(WEBHOOKS.API_LOGIN, embed);
}

module.exports = {
  WEBHOOKS,
  logSiteAccess,
  logLogin,
  logAttack,
  logBotCommand,
  logBotApi,
  logSystemStatus,
  logSystemError,
  logApiLogin
};