const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
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
  return sanitized.substring(0, 100);
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('deletarusuario')
    .setDescription('Remove usuário do plano escolhido (External/Internal · Advanced/Premium)')
    .addStringOption((option) =>
      option.setName('usuario').setDescription('Nome de usuário a remover').setRequired(true)
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
    const sanitizedUsername = sanitizeInput(username);

    if (!sanitizedUsername) {
      return interaction.editReply('❌ Usuário inválido.');
    }

    try {
      const [result] = await pool.query(
        `DELETE FROM \`${usersTable}\` WHERE username = ?`,
        [sanitizedUsername]
      );

      if (result.affectedRows === 0) {
        return interaction.editReply(
          `❌ **${sanitizedUsername}** não encontrado no plano **${formatPlanoLabel(panelId)}**.`
        );
      }

      logSecurityEvent('DISCORD_USER_DELETED', {
        username: sanitizedUsername,
        plano: panelId,
        deletedBy: interaction.user.tag,
      });

      await logBotCommand(
        '/deletarusuario',
        interaction.user.tag,
        interaction.guild?.name || 'DM',
        true,
        `${sanitizedUsername} | plano: ${panelId}`
      );

      return interaction.editReply(
        `🗑️ **${sanitizedUsername}** removido do plano **${formatPlanoLabel(panelId)}**.`
      );
    } catch (err) {
      console.error('Erro no /deletarusuario:', err);
      return interaction.editReply('❌ Erro ao remover usuário.');
    }
  },
};
