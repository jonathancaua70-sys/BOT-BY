const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  MessageFlags,
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
} = require('discord.js');
const crypto = require('crypto');
const { pool } = require('../db');
const fs = require('fs');
const path = require('path');
const { logBotCommand } = require('../webhooks');
const { getKeyTableName } = require('../keyTables');
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

function v2Flags() {
  return MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral;
}

function editV2(interaction, container) {
  return interaction.editReply({
    flags: v2Flags(),
    components: [container],
  });
}

function buildErrorContainer(message) {
  return new ContainerBuilder()
    .setAccentColor(0xff4d4d)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`# Algo deu errado\n${message}`)
    );
}

function buildKeysContainer({ userId, planoLabel, panelId, label, keys }) {
  const lista = keys
    .map((key, i) => `\`${String(i + 1).padStart(2, '0')}\`  \`${key}\``)
    .join('\n');

  return new ContainerBuilder()
    .setAccentColor(0x9b5cff)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        [
          '# Keys geradas',
          `<@${userId}> · mensagem só pra você`,
        ].join('\n')
      )
    )
    .addSeparatorComponents(
      new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)
    )
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        [
          `📦 **Plano** — ${planoLabel}`,
          `⏱ **Duração** — ${label}`,
          `🔢 **Quantidade** — ${keys.length}`,
        ].join('\n')
      )
    )
    .addSeparatorComponents(
      new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)
    )
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        [
          lista,
          '',
          `-# Register do menu: \`"panel": "${panelId}"\``,
        ].join('\n')
      )
    );
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('gerarkey')
    .setDescription('Gera keys: tempo, plano e quantidade')
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
    .addStringOption((option) => applyPlanoChoices(option))
    .addIntegerOption((option) =>
      option
        .setName('quantidade')
        .setDescription('Quantas keys gerar (1 a 25)')
        .setRequired(true)
        .setMinValue(1)
        .setMaxValue(25)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const plano = getPlanoFromInteraction(interaction);
    const planoCheck = validatePlano(plano);
    if (!planoCheck.ok) {
      return editV2(interaction, buildErrorContainer(planoCheck.message));
    }

    const { panelId } = planoCheck;

    console.log('[gerarkey] options.data =', JSON.stringify(interaction.options.data));

    const resolved = resolveTempo(interaction);
    if (!resolved) {
      return editV2(
        interaction,
        buildErrorContainer(
          [
            'A opção **tempo** não chegou no bot.',
            '1. Rode `node src/deployCommands.js`',
            '2. No Discord: Ctrl+R',
            '3. Digite `/gerarkey` de novo e escolha o tempo na lista',
          ].join('\n')
        )
      );
    }

    const { isLifetime, durationDays } = resolved;
    if (!isLifetime && !Number.isFinite(durationDays)) {
      return editV2(interaction, buildErrorContainer('Duração inválida. Tente novamente.'));
    }

    const quantidade = interaction.options.getInteger('quantidade');
    if (!Number.isInteger(quantidade) || quantidade < 1 || quantidade > 25) {
      return editV2(interaction, buildErrorContainer('Quantidade inválida. Use de **1** a **25**.'));
    }

    const keysTable = getKeyTableName(panelId);
    if (!keysTable) {
      return editV2(interaction, buildErrorContainer('Painel inválido. Tente novamente.'));
    }

    try {
      let creatorAvatar = 'https://cdn.discordapp.com/embed/avatars/0.png';
      try {
        creatorAvatar = interaction.user.displayAvatarURL({ size: 128, extension: 'png' });
      } catch (_) {
        try {
          creatorAvatar = interaction.user.displayAvatarURL({ size: 128, format: 'png' });
        } catch (__) {}
      }

      const geradas = [];

      for (let i = 0; i < quantidade; i++) {
        let key;
        let tentativas = 0;

        while (tentativas < 5) {
          key = gerarKey();
          const [existente] = await pool.query(
            `SELECT id FROM \`${keysTable}\` WHERE key_value = ? LIMIT 1`,
            [key]
          );
          if (existente.length === 0) break;
          tentativas++;
        }

        await pool.query(
          `INSERT INTO \`${keysTable}\` (key_value, is_lifetime, duration_days, creator_avatar, panel_id)
           VALUES (?, ?, ?, ?, ?)`,
          [key, isLifetime ? 1 : 0, isLifetime ? null : durationDays, creatorAvatar, panelId]
        );

        geradas.push(key);
      }

      const label = isLifetime ? 'Lifetime' : `${durationDays} dia(s)`;
      const preview = geradas[0].substring(0, 8) + '...';

      logSecurityEvent('DISCORD_KEY_GENERATED', {
        key: preview,
        count: geradas.length,
        duration: label,
        plano: panelId,
        createdBy: interaction.user.tag,
        creatorId: interaction.user.id
      });

      await logBotCommand(
        '/gerarkey',
        interaction.user.tag,
        interaction.guild?.name || 'DM',
        true,
        `${geradas.length} key(s) ${label} | plano: ${panelId}`
      );

      return editV2(
        interaction,
        buildKeysContainer({
          userId: interaction.user.id,
          planoLabel: formatPlanoLabel(panelId),
          panelId,
          label,
          keys: geradas,
        })
      );
    } catch (err) {
      console.error('Erro no /gerarkey:', err);
      if (err && err.code === 'ER_BAD_FIELD_ERROR') {
        return editV2(
          interaction,
          buildErrorContainer('Banco desatualizado. Reinicie o bot ou rode: `node scripts/setupDatabase.js`')
        );
      }
      return editV2(interaction, buildErrorContainer('Ocorreu um erro ao gerar a key.'));
    }
  },
};
