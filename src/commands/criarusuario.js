const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const bcrypt = require('bcryptjs');
const { pool } = require('../db');

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

    // Responde em modo "efêmero" (só quem usou o comando vê a mensagem),
    // já que estamos falando de senha aqui.
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
      const [existentes] = await pool.query(
        'SELECT id FROM users WHERE username = ? LIMIT 1',
        [username]
      );

      if (existentes.length > 0) {
        return interaction.editReply(`❌ Já existe um usuário com o nome **${username}**.`);
      }

      const hash = await bcrypt.hash(password, 10);
      
      // Captura informações do criador
      const creator = interaction.user;
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
        [username, hash, creator.tag, creatorAvatar, creatorRole, creatorAvatar]
      );

      return interaction.editReply(
        `✅ Usuário **${username}** criado com sucesso por ${creator.tag}!`
      );
    } catch (err) {
      console.error('Erro no /criarusuario:', err);
      return interaction.editReply('❌ Ocorreu um erro ao criar o usuário. Veja os logs do bot.');
    }
  },
};
