const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { pool } = require('../db');
const { logBotCommand } = require('../webhooks');
const { PANEL_IDS, getPanelConfig, getUsersTableName, isValidPanelId } = require('../panels');
const { applyPlanoChoices, getPlanoFromInteraction, formatPlanoLabel } = require('../discordPanelChoices');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('listarusuarios')
    .setDescription('Lista usuários por plano (5 planos: External/Internal/DU7)')
    .addStringOption((option) => applyPlanoChoices(option, { required: false }))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
      const planoFilter = getPlanoFromInteraction(interaction);
      const panelsToList =
        planoFilter && isValidPanelId(planoFilter) ? [planoFilter] : PANEL_IDS;

      const sections = [];

      for (const panelId of panelsToList) {
        const panel = getPanelConfig(panelId);
        const usersTable = getUsersTableName(panelId);
        if (!usersTable) continue;

        const [rows] = await pool.query(
          `SELECT username, created_by, created_at FROM \`${usersTable}\` ORDER BY created_at DESC LIMIT 25`
        );

        if (rows.length === 0) {
          sections.push(`**${formatPlanoLabel(panelId)}** (\`${usersTable}\`)\n📭 Nenhum usuário.`);
          continue;
        }

        const lista = rows
          .map(
            (u, i) =>
              `${i + 1}. ${u.username} — ${u.created_by ?? 'desconhecido'} (${new Date(u.created_at).toLocaleString('pt-BR')})`
          )
          .join('\n');

        sections.push(`**${formatPlanoLabel(panelId)}** (\`${usersTable}\`)\n${lista}`);
      }

      if (sections.length === 0) {
        return interaction.editReply('📭 Nenhum plano encontrado.');
      }

      const header = planoFilter
        ? `📋 **Usuários — ${formatPlanoLabel(planoFilter)}:**`
        : '📋 **Usuários por plano:**';

      return interaction.editReply(`${header}\n\n${sections.join('\n\n')}`);
    } catch (err) {
      console.error('Erro no /listarusuarios:', err);
      await logBotCommand(
        '/listarusuarios',
        interaction.user.tag,
        interaction.guild?.name || 'DM',
        false,
        `Erro: ${err.message}`
      );
      return interaction.editReply('❌ Erro ao listar usuários.');
    }
  },
};
