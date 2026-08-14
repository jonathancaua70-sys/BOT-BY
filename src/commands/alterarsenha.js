const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const bcrypt = require('bcryptjs');
const { pool } = require('../db');
const { logBotCommand } = require('../webhooks');
const { applyPlanoChoices, getPlanoFromInteraction, validatePlano, formatPlanoLabel } = require('../discordPanelChoices');

function sanitizeInput(input) {
  if (typeof input !== 'string') return input;
  return input.replace(/[\x00-\x1F\x7F]/g, '').substring(0, 100);
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('alterarsenha')
    .setDescription('Altera a senha de um usuário no plano escolhido')
    .addStringOption((option) =>
      option.setName('usuario').setDescription('Nome de usuário').setRequired(true)
    )
    .addStringOption((option) =>
      option.setName('senha').setDescription('Nova senha').setRequired(true)
    )
    .addStringOption((option) => applyPlanoChoices(option))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    const username = interaction.options.getString('usuario');
    const password = interaction.options.getString('senha');
    const plano = getPlanoFromInteraction(interaction);
    const planoCheck = validatePlano(plano);

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    if (!planoCheck.ok) {
      return interaction.editReply(planoCheck.message);
    }

    if (!password || password.length < 1 || password.length > 128) {
      return interaction.editReply('❌ Senha deve ter 1-128 caracteres.');
    }

    const { panelId, usersTable } = planoCheck;
    const sanitizedUsername = sanitizeInput(username);

    try {
      const hash = await bcrypt.hash(password, 12);
      const [result] = await pool.query(
        `UPDATE \`${usersTable}\` SET password = ? WHERE username = ?`,
        [hash, sanitizedUsername]
      );

      if (result.affectedRows === 0) {
        return interaction.editReply(
          `❌ **${sanitizedUsername}** não encontrado no plano **${formatPlanoLabel(panelId)}**.`
        );
      }

      await logBotCommand(
        '/alterarsenha',
        interaction.user.tag,
        interaction.guild?.name || 'DM',
        true,
        `${sanitizedUsername} | plano: ${panelId}`
      );

      return interaction.editReply(
        `✅ Senha de **${sanitizedUsername}** atualizada no plano **${formatPlanoLabel(panelId)}**.`
      );
    } catch (err) {
      console.error('Erro no /alterarsenha:', err);
      return interaction.editReply('❌ Erro ao alterar senha.');
    }
  },
};
