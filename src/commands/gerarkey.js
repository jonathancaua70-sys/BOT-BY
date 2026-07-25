const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const crypto = require('crypto');
const { pool } = require('../db');

// Gera um bloco de 4 caracteres alfanuméricos maiúsculos (ex: "A1B2")
function gerarBloco() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let bloco = '';
  const bytes = crypto.randomBytes(4);
  for (let i = 0; i < 4; i++) {
    bloco += chars[bytes[i] % chars.length];
  }
  return bloco;
}

// Gera uma key no formato XXXX-XXXX-XXXX-XXXX
function gerarKey() {
  return [gerarBloco(), gerarBloco(), gerarBloco(), gerarBloco()].join('-');
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('gerarkey')
    .setDescription('Gera uma key aleatória e permanente, e salva no banco')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
      let key;
      let tentativas = 0;

      // Garante que a key gerada não colide com uma já existente no banco
      while (tentativas < 5) {
        key = gerarKey();
        const [existente] = await pool.query(
          'SELECT id FROM keys_table WHERE key_value = ? LIMIT 1',
          [key]
        );
        if (existente.length === 0) break;
        tentativas++;
      }

      await pool.query(
        'INSERT INTO keys_table (key_value, created_by) VALUES (?, ?)',
        [key, interaction.user.tag]
      );

      return interaction.editReply(
        `🔑 Key gerada com sucesso:\n\`\`\`${key}\`\`\`\nEssa key é permanente até ser usada.`
      );
    } catch (err) {
      console.error('Erro no /gerarkey:', err);
      return interaction.editReply('❌ Ocorreu um erro ao gerar a key.');
    }
  },
};
