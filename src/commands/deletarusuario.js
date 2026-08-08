const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { pool } = require('../db');

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

    try {
      const [result] = await pool.query('DELETE FROM users WHERE username = ?', [username]);

      if (result.affectedRows === 0) {
        return interaction.editReply(`❌ Nenhum usuário encontrado com o nome **${username}**.`);
      }

      return interaction.editReply(`🗑️ Usuário **${username}** removido com sucesso.`);
    } catch (err) {
      console.error('Erro no /deletarusuario:', err);
      return interaction.editReply('❌ Ocorreu um erro ao remover o usuário.');
    }
  },
};
