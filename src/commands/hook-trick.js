const fs = require('fs');
const path = require('path');
const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  MessageFlags,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  AttachmentBuilder,
} = require('discord.js');
const { logBotCommand } = require('../webhooks');
const { loadShopConfig, saveShopConfig, isHttpUrl } = require('../hookTrickShop');

const BANNER_PATH = path.join(__dirname, '../../assets/hooktrick-banner.png');
const BANNER_FULL_PATH = path.join(__dirname, '../../assets/hooktrick-banner-full.png');

function buildShopEmbed(imageUrl) {
  return new EmbedBuilder()
    .setColor(0x111111)
    .setTitle('Hook Trick')
    .setDescription(
      [
        '• Menu com uma interface moderna',
        '• Compatibilidade Total',
        '• Menu totalmente otimizado',
        '',
        '**ESP PERFEITO**',
        'Veja todos os jogadores através das paredes, itens e veículos com um sistema ultra-otimizado.',
        '',
        '**AIMBOT INTELIGENTE**',
        'Mira ajustável por distância, suavidade e prioridade (cabeça/peito).',
        '',
        '**COMPATIBILIDADE TOTAL**',
        'Funciona em todos os emuladores (Bluestacks, MSI 4/5, P64, N32).',
        '',
        '**SEM RISCO**',
        'Código atualizado para manter o menu estável.',
        '',
        'Não perca tempo! Compre agora e seja o mais temido do servidor.',
      ].join('\n')
    )
    .setImage(imageUrl)
    .setFooter({ text: "Clique no botão 'Comprar'" });
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('hook-trick')
    .setDescription('Loja Hook Trick')
    .addSubcommand((sub) =>
      sub
        .setName('configure')
        .setDescription('Configura o link da loja e envia o embed com o botão Comprar')
        .addStringOption((option) =>
          option
            .setName('link')
            .setDescription('Link da loja (botão Comprar)')
            .setRequired(true)
        )
        .addChannelOption((option) =>
          option
            .setName('canal')
            .setDescription('Canal onde a loja vai ser enviada')
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
            .setRequired(false)
        )
        .addStringOption((option) =>
          option
            .setName('imagem')
            .setDescription('Link da imagem do embed (opcional)')
            .setRequired(false)
        )
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    if (sub !== 'configure') {
      return interaction.reply({
        content: '❌ Subcomando inválido.',
        flags: MessageFlags.Ephemeral,
      });
    }

    const shopUrl = String(interaction.options.getString('link') || '').trim();
    const imageUrlOption = String(interaction.options.getString('imagem') || '').trim();
    const channel = interaction.options.getChannel('canal') || interaction.channel;

    if (!isHttpUrl(shopUrl)) {
      return interaction.reply({
        content: '❌ O **link** da loja precisa ser uma URL http/https válida.',
        flags: MessageFlags.Ephemeral,
      });
    }

    if (imageUrlOption && !isHttpUrl(imageUrlOption)) {
      return interaction.reply({
        content: '❌ O **imagem** precisa ser uma URL http/https válida.',
        flags: MessageFlags.Ephemeral,
      });
    }

    if (!channel || !channel.isTextBased()) {
      return interaction.reply({
        content: '❌ Escolhe um canal de texto válido.',
        flags: MessageFlags.Ephemeral,
      });
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    saveShopConfig({
      shopUrl,
      imageUrl: imageUrlOption || loadShopConfig().imageUrl || '',
      channelId: channel.id,
      guildId: interaction.guildId,
    });

    const files = [];
    let embedImage = imageUrlOption || loadShopConfig().imageUrl;

    if (!embedImage) {
      const bannerFile = fs.existsSync(BANNER_PATH) ? BANNER_PATH : BANNER_FULL_PATH;
      if (fs.existsSync(bannerFile)) {
        files.push(new AttachmentBuilder(bannerFile, { name: 'hooktrick-banner.png' }));
        embedImage = 'attachment://hooktrick-banner.png';
      }
    }

    if (!embedImage) {
      embedImage = interaction.client.user.displayAvatarURL({ size: 512, extension: 'png' });
    }

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setLabel('Comprar')
        .setEmoji('🛒')
        .setStyle(ButtonStyle.Link)
        .setURL(shopUrl)
    );

    await channel.send({
      embeds: [buildShopEmbed(embedImage)],
      components: [row],
      files,
    });

    await logBotCommand(
      '/hook-trick configure',
      interaction.user.tag,
      interaction.guild?.name || 'DM',
      true,
      `canal: #${channel.name}`
    );

    return interaction.editReply(
      `✅ Loja **Hook Trick** enviada em ${channel}.\n🛒 Comprar: ${shopUrl}`
    );
  },
};
