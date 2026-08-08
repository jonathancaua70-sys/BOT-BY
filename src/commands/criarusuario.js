const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const bcrypt = require('bcryptjs');
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

// Validação de usuário e senha
function validateCredentials(username, password) {
  if (!username || !password) {
    return { valid: false, message: 'Usuário e senha são obrigatórios.' };
  }
  
  const usernameValidation = validateUsername(username);
  if (!usernameValidation.valid) {
    return usernameValidation;
  }
  
  if (password.length < 8) {
    return { valid: false, message: 'A senha deve ter no mínimo 8 caracteres.' };
  }
  
  if (!/[A-Z]/.test(password)) {
    return { valid: false, message: 'A senha deve conter pelo menos 1 letra maiúscula.' };
  }
  
  if (!/[a-z]/.test(password)) {
    return { valid: false, message: 'A senha deve conter pelo menos 1 letra minúscula.' };
  }
  
  if (!/[0-9]/.test(password)) {
    return { valid: false, message: 'A senha deve conter pelo menos 1 número.' };
  }
  
  if (password.toLowerCase().includes(username.toLowerCase())) {
    return { valid: false, message: 'A senha não pode conter seu nome de usuário.' };
  }
  
  const commonPasswords = ['password', '12345678', 'admin123', 'qwerty', 'letmein'];
  if (commonPasswords.includes(password.toLowerCase())) {
    return { valid: false, message: 'Esta senha é muito comum. Escolha uma senha mais forte.' };
  }
  
  return { valid: true };
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('criarusuario')
    .setDescription('Cria um novo usuário no banco de login do painel')
    .addStringOption((option) =>
      option.setName('usuario').setDescription('Nome de usuário').setRequired(true)
    )
    .addStringOption((option) =>
      option.setName('senha').setDescription('Senha do usuário').setRequired(true)
    )
    // Só quem tem permissão de administrador no servidor pode usar esse comando
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    const username = interaction.options.getString('usuario');
    const password = interaction.options.getString('senha');

    // Captura informações do criador
    const creator = interaction.user;

    // Responde em modo "efêmero" (só quem usou o comando vê a mensagem),
    // já que estamos falando de senha aqui.
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    // Valida as credenciais
    const validation = validateCredentials(username, password);
    if (!validation.valid) {
      logSecurityEvent('DISCORD_USER_CREATION_VALIDATION_FAILED', {
        username,
        discordUser: creator.tag,
        discordId: creator.id,
        reason: validation.message
      });
      return interaction.editReply(`❌ ${validation.message}`);
    }
    
    const sanitizedUsername = sanitizeInput(username);

    try {
      const [existentes] = await pool.query(
        'SELECT id FROM users WHERE username = ? LIMIT 1',
        [sanitizedUsername]
      );

      if (existentes.length > 0) {
        return interaction.editReply(`❌ Já existe um usuário com o nome **${sanitizedUsername}**.`);
      }

      const hash = await bcrypt.hash(password, 12);
      
      const creatorAvatar = creator.displayAvatarURL({ size: 128, format: 'png' });
      
      // Determina o cargo do criador (verifica se é admin)
      let creatorRole = 'member';
      try {
        const member = await interaction.guild.members.fetch(creator.id);
        const hasAdmin = member.permissions.has(PermissionFlagsBits.Administrator);
        creatorRole = hasAdmin ? 'admin' : 'member';
      } catch (err) {
        console.log('Não foi possível verificar permissões do membro:', err.message);
      }

      await pool.query(
        'INSERT INTO users (username, password, created_by, creator_avatar, creator_role, user_avatar) VALUES (?, ?, ?, ?, ?, ?)',
        [sanitizedUsername, hash, creator.tag, creatorAvatar, creatorRole, creatorAvatar]
      );

      logSecurityEvent('DISCORD_USER_CREATED', {
        username: sanitizedUsername,
        createdBy: creator.tag,
        creatorId: creator.id,
        creatorRole: creatorRole
      });

      // Loga o comando no webhook
      await logBotCommand(
        '/criarusuario',
        creator.tag,
        interaction.guild?.name || 'DM',
        true,
        `Usuário criado: ${sanitizedUsername}`
      );

      return interaction.editReply(
        `✅ Usuário **${sanitizedUsername}** criado com sucesso por ${creator.tag}!`
      );
    } catch (err) {
      console.error('Erro no /criarusuario:', err);
      return interaction.editReply('❌ Ocorreu um erro ao criar o usuário. Veja os logs do bot.');
    }
  },
};
