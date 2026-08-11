const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { pool } = require('../db');
const fs = require('fs');
const path = require('path');
const { logBotCommand } = require('../webhooks');

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
  try { sanitized = sanitized.normalize('NFC'); } catch (e) {}
  return sanitized.substring(0, 100);
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('resethwid')
    .setDescription('Reseta o HWID travado de um usuário (permite novo login de qualquer PC)')
    .addStringOption((option) =>
      option.setName('usuario').setDescription('Nome de usuário no menu').setRequired(true)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    const username = interaction.options.getString('usuario');
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const sanitizedUsername = sanitizeInput(username);
    if (!sanitizedUsername) {
      return interaction.editReply('❌ Usuário inválido.');
    }

    try {
      const [rows] = await pool.query(
        'SELECT id, username, hwid FROM users WHERE username = ? LIMIT 1',
        [sanitizedUsername]
      );

      if (rows.length === 0) {
        return interaction.editReply(`❌ Usuário **${sanitizedUsername}** não encontrado.`);
      }

      const oldHwid = rows[0].hwid || '(nenhum)';

      await pool.query(
        'UPDATE users SET hwid = NULL WHERE id = ?',
        [rows[0].id]
      );

      logSecurityEvent('DISCORD_HWID_RESET', {
        username: sanitizedUsername,
        oldHwid: String(oldHwid).substring(0, 32),
        by: interaction.user.tag,
        byId: interaction.user.id
      });

      await logBotCommand(
        '/resethwid',
        interaction.user.tag,
        interaction.guild?.name || 'DM',
        true,
        `HWID resetado: ${sanitizedUsername}`
      );

      return interaction.editReply(
        `✅ HWID de **${sanitizedUsername}** resetado.\n` +
        `Anterior: \`${oldHwid}\`\n` +
        `Qualquer PC pode logar de novo — o próximo login salva o HWID novo.`
      );
    } catch (err) {
      console.error('Erro no /resethwid:', err);
      if (err && err.code === 'ER_BAD_FIELD_ERROR') {
        return interaction.editReply(
          '❌ Coluna `hwid` não existe no banco. Rode o ALTER do schema.sql primeiro.'
        );
      }
      return interaction.editReply('❌ Erro ao resetar HWID. Veja os logs do bot.');
    }
  },
};
