const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const crypto = require('crypto');
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

function gerarBloco() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let bloco = '';
  const bytes = crypto.randomBytes(4);
  for (let i = 0; i < 4; i++) {
    bloco += chars[bytes[i] % chars.length];
  }
  return bloco;
}

function gerarKey() {
  return [gerarBloco(), gerarBloco(), gerarBloco(), gerarBloco()].join('-');
}

function resolveTempo(interaction) {
  // Preferência: integer (choices numéricas)
  const asInt = interaction.options.getInteger('tempo');
  if (asInt !== null && asInt !== undefined) {
    if (asInt === 0) return { isLifetime: true, durationDays: null };
    if (Number.isFinite(asInt) && asInt > 0) return { isLifetime: false, durationDays: asInt };
  }

  // Fallback: string (caso ainda exista comando antigo)
  const asStr = interaction.options.getString('tempo');
  if (asStr !== null && asStr !== undefined && String(asStr).trim() !== '') {
    const raw = String(asStr).trim().toLowerCase();
    if (raw === 'lifetime' || raw === '0') return { isLifetime: true, durationDays: null };
    const n = Number.parseInt(raw, 10);
    if (Number.isFinite(n) && n > 0) return { isLifetime: false, durationDays: n };
  }

  // Fallback: opção "dias" + "lifetime"
  const life = interaction.options.getBoolean('lifetime');
  const dias = interaction.options.getInteger('dias');
  if (life === true) return { isLifetime: true, durationDays: null };
  if (dias !== null && dias !== undefined && Number.isFinite(dias) && dias > 0) {
    return { isLifetime: false, durationDays: dias };
  }

  return null;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('gerarkey')
    .setDescription('Gera uma key com duração (ou lifetime) e salva no banco')
    .addIntegerOption((option) =>
      option
        .setName('tempo')
        .setDescription('Quanto tempo a key/conta vai durar')
        .setRequired(true)
        .addChoices(
          { name: '1 Dia', value: 1 },
          { name: '3 Dias', value: 3 },
          { name: '7 Dias', value: 7 },
          { name: '15 Dias', value: 15 },
          { name: '30 Dias', value: 30 },
          { name: '90 Dias', value: 90 },
          { name: '365 Dias', value: 365 },
          { name: 'Lifetime', value: 0 }
        )
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    console.log('[gerarkey] options.data =', JSON.stringify(interaction.options.data));

    const resolved = resolveTempo(interaction);
    if (!resolved) {
      return interaction.editReply(
        '❌ Opção **tempo** não chegou no bot.\n' +
        '1) No PC, na pasta do bot: `node src/deployCommands.js`\n' +
        '2) No Discord: Ctrl+R (recarregar) ou sair/entrar no server\n' +
        '3) Digite `/gerarkey` de novo e **escolha** o tempo na lista'
      );
    }

    const { isLifetime, durationDays } = resolved;
    if (!isLifetime && !Number.isFinite(durationDays)) {
      return interaction.editReply('❌ Duração inválida. Tente novamente.');
    }

    try {
      let key;
      let tentativas = 0;

      while (tentativas < 5) {
        key = gerarKey();
        const [existente] = await pool.query(
          'SELECT id FROM keys_table WHERE key_value = ? LIMIT 1',
          [key]
        );
        if (existente.length === 0) break;
        tentativas++;
      }

      let creatorAvatar = 'https://cdn.discordapp.com/embed/avatars/0.png';
      try {
        creatorAvatar = interaction.user.displayAvatarURL({ size: 128, extension: 'png' });
      } catch (_) {
        try {
          creatorAvatar = interaction.user.displayAvatarURL({ size: 128, format: 'png' });
        } catch (__) {}
      }

      await pool.query(
        `INSERT INTO keys_table (key_value, is_lifetime, duration_days, creator_avatar)
         VALUES (?, ?, ?, ?)`,
        [key, isLifetime ? 1 : 0, isLifetime ? null : durationDays, creatorAvatar]
      );

      const label = isLifetime ? 'Lifetime' : `${durationDays} dia(s)`;

      logSecurityEvent('DISCORD_KEY_GENERATED', {
        key: key.substring(0, 8) + '...',
        duration: label,
        createdBy: interaction.user.tag,
        creatorId: interaction.user.id
      });

      await logBotCommand(
        '/gerarkey',
        interaction.user.tag,
        interaction.guild?.name || 'DM',
        true,
        `Key ${label}: ${key.substring(0, 8)}...`
      );

      return interaction.editReply(
        `🔑 Key gerada com sucesso:\n\`\`\`${key}\`\`\`\n⏱ Duração: **${label}**\n` +
        `A duração começa a contar quando a key for usada no Register do menu.`
      );
    } catch (err) {
      console.error('Erro no /gerarkey:', err);
      if (err && err.code === 'ER_BAD_FIELD_ERROR') {
        return interaction.editReply(
          '❌ Colunas de duração/avatar faltando no banco. Rode os ALTER do schema.sql.'
        );
      }
      return interaction.editReply('❌ Ocorreu um erro ao gerar a key.');
    }
  },
};
