const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { pool } = require('../db');
const fs = require('fs');
const path = require('path');
const { logBotCommand } = require('../webhooks');
const { applyPlanoChoices, getPlanoFromInteraction, validatePlano, formatPlanoLabel } = require('../discordPanelChoices');
const { isExternalPanel } = require('../panels');

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
  return sanitized.substring(0, 100);
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('resethwid')
    .setDescription('Reseta HWID de usuário no plano External (Advanced/Premium)')
    .addStringOption((option) =>
      option.setName('usuario').setDescription('Nome de usuário no menu').setRequired(true)
    )
    .addStringOption((option) => applyPlanoChoices(option))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    const username = interaction.options.getString('usuario');
    const plano = getPlanoFromInteraction(interaction);
    const planoCheck = validatePlano(plano);

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    if (!planoCheck.ok) {
      return interaction.editReply(planoCheck.message);
    }

    const { panelId, usersTable } = planoCheck;

    if (!isExternalPanel(panelId)) {
      return interaction.editReply(
        '❌ Reset de HWID só vale para planos externos (**External Advanced**, **External Premium**, **DU7**).'
      );
    }

    const sanitizedUsername = sanitizeInput(username);
    if (!sanitizedUsername) {
      return interaction.editReply('❌ Usuário inválido.');
    }

    try {
      const [rows] = await pool.query(
        `SELECT id, username, hwid FROM \`${usersTable}\` WHERE username = ? LIMIT 1`,
        [sanitizedUsername]
      );

      if (rows.length === 0) {
        return interaction.editReply(
          `❌ **${sanitizedUsername}** não encontrado no plano **${formatPlanoLabel(panelId)}**.`
        );
      }

      const oldHwid = rows[0].hwid || '(nenhum)';

      await pool.query(`UPDATE \`${usersTable}\` SET hwid = NULL WHERE id = ?`, [rows[0].id]);

      logSecurityEvent('DISCORD_HWID_RESET', {
        username: sanitizedUsername,
        plano: panelId,
        oldHwid: String(oldHwid).substring(0, 32),
        by: interaction.user.tag,
      });

      await logBotCommand(
        '/resethwid',
        interaction.user.tag,
        interaction.guild?.name || 'DM',
        true,
        `${sanitizedUsername} | plano: ${panelId}`
      );

      return interaction.editReply(
        `✅ HWID de **${sanitizedUsername}** resetado (**${formatPlanoLabel(panelId)}**).\n` +
          `Anterior: \`${oldHwid}\`\n` +
          `Próximo login salva o HWID novo.`
      );
    } catch (err) {
      console.error('Erro no /resethwid:', err);
      if (err && err.code === 'ER_BAD_FIELD_ERROR') {
        return interaction.editReply('❌ Coluna `hwid` ausente. Rode `node scripts/setupDatabase.js`.');
      }
      return interaction.editReply('❌ Erro ao resetar HWID.');
    }
  },
};
