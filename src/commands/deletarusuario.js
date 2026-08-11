const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { pool } = require('../db');
const fs = require('fs');
const path = require('path');
const { logBotCommand } = require('../webhooks');

// Sistema de logs de segurança
const securityLogPath = path.join(__dirname, '../../logs/security.log');

function logSecurityEvent(eventType, details) {
  const timestamp = new Date().toISOString();
  const logEntry = {
    timestamp,
    eventType,
    ...details
  };
  
  const logLine = JSON.stringify(logEntry) + '\n';
  
  // Garante que o diretório de logs existe
  const logsDir = path.dirname(securityLogPath);
  if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
  }
  
  // Escreve no arquivo de log
  fs.appendFile(securityLogPath, logLine, (err) => {
    if (err) {
      console.error('Erro ao escrever no log de segurança:', err);
    }
  });
  
  console.log(`[SECURITY] ${eventType}:`, details);
}

// Função de sanitização melhorada para prevenir XSS
function sanitizeInput(input) {
  if (typeof input !== 'string') return input;
  
  let sanitized = input.replace(/[\x00-\x1F\x7F]/g, '');
  
  try {
    sanitized = sanitized.normalize('NFC');
  } catch (e) {
    // Se normalização falhar, continua com o original
  }
  
  const htmlEscapeMap = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#x27;',
    '/': '&#x2F;'
  };
  
  sanitized = sanitized.replace(/[&<>"'/]/g, (match) => htmlEscapeMap[match]);
  
  const dangerousPatterns = [
    /javascript:/gi,
    /data:/gi,
    /vbscript:/gi,
    /on\w+\s*=/gi,
    /<\s*script/gi,
    /<\s*iframe/gi,
    /<\s*object/gi,
    /<\s*embed/gi
  ];
  
  for (const pattern of dangerousPatterns) {
    sanitized = sanitized.replace(pattern, '');
  }
  
  const maxLength = 1000;
  if (sanitized.length > maxLength) {
    sanitized = sanitized.substring(0, maxLength);
  }
  
  return sanitized;
}

// Validação mais robusta de username
function validateUsername(username) {
  if (!username || typeof username !== 'string') {
    return { valid: false, message: 'Nome de usuário inválido.' };
  }
  
  if (username.length < 3 || username.length > 20) {
    return { valid: false, message: 'Nome de usuário deve ter 3-20 caracteres.' };
  }
  
  const asciiUsername = username.normalize('NFKC');
  const usernameRegex = /^[a-zA-Z0-9_]+$/;
  
  if (!usernameRegex.test(asciiUsername)) {
    return { valid: false, message: 'Nome de usuário deve conter apenas letras, números e underscore (ASCII).' };
  }
  
  if (username !== asciiUsername) {
    return { valid: false, message: 'Nome de usuário não pode conter caracteres especiais Unicode.' };
  }
  
  return { valid: true };
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('deletarusuario')
    .setDescription('Remove um usuário do banco de login do painel')
    .addStringOption((option) =>
      option.setName('usuario').setDescription('Nome de usuário a remover').setRequired(true)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    const username = interaction.options.getString('usuario');
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    // Valida username
    const usernameRegex = /^[a-zA-Z0-9_]{3,20}$/;
    if (!usernameRegex.test(username)) {
      logSecurityEvent('DISCORD_USER_DELETION_VALIDATION_FAILED', {
        username,
        discordUser: interaction.user.tag,
        discordId: interaction.user.id,
        reason: 'Nome de usuário inválido'
      });
      return interaction.editReply('❌ Nome de usuário inválido. Use apenas letras, números e underscore (3-20 caracteres).');
    }

    const sanitizedUsername = sanitizeInput(username);

    try {
      const [result] = await pool.query('DELETE FROM users WHERE username = ?', [sanitizedUsername]);

      if (result.affectedRows === 0) {
        logSecurityEvent('DISCORD_USER_DELETION_NOT_FOUND', {
          username: sanitizedUsername,
          discordUser: interaction.user.tag,
          discordId: interaction.user.id
        });
        return interaction.editReply(`❌ Nenhum usuário encontrado com o nome **${sanitizedUsername}**.`);
      }

      logSecurityEvent('DISCORD_USER_DELETED', {
        username: sanitizedUsername,
        deletedBy: interaction.user.tag,
        deleterId: interaction.user.id
      });

      // Loga o comando no webhook
      await logBotCommand(
        '/deletarusuario',
        interaction.user.tag,
        interaction.guild?.name || 'DM',
        true,
        `Usuário deletado: ${sanitizedUsername}`
      );

      return interaction.editReply(`🗑️ Usuário **${sanitizedUsername}** removido com sucesso.`);
    } catch (err) {
      console.error('Erro no /deletarusuario:', err);
      logSecurityEvent('DISCORD_USER_DELETION_ERROR', {
        username: sanitizedUsername,
        discordUser: interaction.user.tag,
        error: err.message
      });
      
      // Loga o erro no webhook
      await logBotCommand(
        '/deletarusuario',
        interaction.user.tag,
        interaction.guild?.name || 'DM',
        false,
        `Erro: ${err.message}`
      );
      
      return interaction.editReply('❌ Ocorreu um erro ao remover o usuário.');
    }
  },
};
