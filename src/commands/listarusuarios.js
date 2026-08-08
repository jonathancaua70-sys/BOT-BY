const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { pool } = require('../db');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('listarusuarios')
    .setDescription('Lista os usuários cadastrados no banco de login do painel')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
      const [rows] = await pool.query(
        'SELECT username, created_by, created_at FROM users ORDER BY created_at DESC LIMIT 25'
      );

      if (rows.length === 0) {
        return interaction.editReply('📭 Nenhum usuário cadastrado ainda.');
      }

      const lista = rows
        .map(
          (u, i) =>
            `**${i + 1}.** ${u.username} — criado por ${u.created_by ?? 'desconhecido'} em ${new Date(
              u.created_at
            ).toLocaleString('pt-BR')}`
        )
        .join('\n');

      return interaction.editReply(`📋 **Usuários cadastrados (últimos 25):**\n${lista}`);
    } catch (err) {
      console.error('Erro no /listarusuarios:', err);
      return interaction.editReply('❌ Ocorreu um erro ao listar os usuários.');
    }
  },
};
