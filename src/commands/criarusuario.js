const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const bcrypt = require('bcryptjs');
const { pool } = require('../db');
const fs = require('fs');
const path = require('path');
const { logBotCommand } = require('../webhooks');
const { applyPlanoChoices, getPlanoFromInteraction, validatePlano, formatPlanoLabel } = require('../discordPanelChoices');

const securityLogPath = path.join(__dirname, '../../logs/security.log');

function logSecurityEvent(eventType, details) {
  const timestamp = new Date().toISOString();
  const logEntry = { timestamp, eventType, ...details };
  const logsDir = path.dirname(securityLogPath);
  if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
  }
  fs.appendFile(securityLogPath, JSON.stringify(logEntry) + '\n', (err) => {
    if (err) console.error('Erro ao escrever no log de segurança:', err);
  });
  console.log(`[SECURITY] ${eventType}:`, details);
}

function sanitizeInput(input) {
  if (typeof input !== 'string') return input;
  let sanitized = input.replace(/[\x00-\x1F\x7F]/g, '');
  try {
    sanitized = sanitized.normalize('NFC');
  } catch (e) {}
  const htmlEscapeMap = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#x27;', '/': '&#x2F;' };
  sanitized = sanitized.replace(/[&<>"'/]/g, (match) => htmlEscapeMap[match]);
  return sanitized.substring(0, 1000);
}

function validateCredentials(username, password) {
  if (!username || !password) {
    return { valid: false, message: 'Usuário e senha são obrigatórios.' };
  }
  const trimmed = String(username).trim();
  if (trimmed.length < 1 || trimmed.length > 50) {
    return { valid: false, message: 'Usuário deve ter 1-50 caracteres.' };
  }
  if (typeof password !== 'string' || password.length < 1 || password.length > 128) {
    return { valid: false, message: 'Senha deve ter 1-128 caracteres.' };
  }
  return { valid: true };
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('criarusuario')
    .setDescription('Cria usuário no plano escolhido (5 planos: External/Internal/DU7)')
    .addStringOption((option) =>
      option.setName('usuario').setDescription('Nome de usuário').setRequired(true)
    )
    .addStringOption((option) =>
      option.setName('senha').setDescription('Senha do usuário').setRequired(true)
    )
    .addStringOption((option) => applyPlanoChoices(option))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    const username = interaction.options.getString('usuario');
    const password = interaction.options.getString('senha');
    const plano = getPlanoFromInteraction(interaction);
    const planoCheck = validatePlano(plano);

    if (!planoCheck.ok) {
      return interaction.reply({ content: planoCheck.message, flags: MessageFlags.Ephemeral });
    }

    const { panelId, usersTable } = planoCheck;
    const creator = interaction.user;

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const validation = validateCredentials(username, password);
    if (!validation.valid) {
      logSecurityEvent('DISCORD_USER_CREATION_VALIDATION_FAILED', {
        username,
        plano: panelId,
        discordUser: creator.tag,
        reason: validation.message,
      });
      return interaction.editReply(`❌ ${validation.message}`);
    }

    const sanitizedUsername = sanitizeInput(username);

    try {
      const [existentes] = await pool.query(
        `SELECT id FROM \`${usersTable}\` WHERE username = ? LIMIT 1`,
        [sanitizedUsername]
      );

      if (existentes.length > 0) {
        return interaction.editReply(
          `❌ Já existe **${sanitizedUsername}** no plano **${formatPlanoLabel(panelId)}**.`
        );
      }

      const hash = await bcrypt.hash(password, 12);
      const creatorAvatar = creator.displayAvatarURL({ size: 128, format: 'png' });

      let creatorRole = 'member';
      try {
        const member = await interaction.guild.members.fetch(creator.id);
        creatorRole = member.permissions.has(PermissionFlagsBits.Administrator) ? 'admin' : 'member';
      } catch (err) {
        console.log('Não foi possível verificar permissões do membro:', err.message);
      }

      await pool.query(
        `INSERT INTO \`${usersTable}\` (username, password, created_by, creator_avatar, creator_role, user_avatar)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [sanitizedUsername, hash, creator.tag, creatorAvatar, creatorRole, creatorAvatar]
      );

      logSecurityEvent('DISCORD_USER_CREATED', {
        username: sanitizedUsername,
        plano: panelId,
        usersTable,
        createdBy: creator.tag,
      });

      await logBotCommand(
        '/criarusuario',
        creator.tag,
        interaction.guild?.name || 'DM',
        true,
        `${sanitizedUsername} | plano: ${panelId}`
      );

      return interaction.editReply(
        `✅ **${sanitizedUsername}** criado no plano **${formatPlanoLabel(panelId)}** (\`${usersTable}\`).`
      );
    } catch (err) {
      console.error('Erro no /criarusuario:', err);
      return interaction.editReply('❌ Erro ao criar usuário. Veja os logs do bot.');
    }
  },
};
