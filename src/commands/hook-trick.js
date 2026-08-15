const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  MessageFlags,
  ChannelType,
} = require('discord.js');
const { logBotCommand } = require('../webhooks');
const { loadShopConfig, saveShopConfig, isHttpUrl, parseIdList } = require('../hookTrickShop');
const { buildPublicShopContainer, resolveBanner, v2Flags } = require('../hookTrickBuy');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('hook-trick')
    .setDescription('Loja Hook Trick')
    .addSubcommand((sub) =>
      sub
        .setName('configure')
        .setDescription('Envia a loja. O botão Comprar abre um tópico privado')
        .addStringOption((option) =>
          option
            .setName('link')
            .setDescription('Link de pagamento (usado dentro do tópico)')
            .setRequired(false)
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
            .setDescription('Link da imagem do painel (opcional)')
            .setRequired(false)
        )
        .addStringOption((option) =>
          option
            .setName('staff')
            .setDescription('IDs da staff que entram no tópico (separados por espaço)')
            .setRequired(false)
        )
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    if (interaction.options.getSubcommand() !== 'configure') {
      return interaction.reply({
        content: '❌ Subcomando inválido.',
        flags: MessageFlags.Ephemeral,
      });
    }

    const shopUrl = String(interaction.options.getString('link') || '').trim();
    const imageUrlOption = String(interaction.options.getString('imagem') || '').trim();
    const staffOption = String(interaction.options.getString('staff') || '').trim();
    const channel = interaction.options.getChannel('canal') || interaction.channel;

    if (shopUrl && !isHttpUrl(shopUrl)) {
      return interaction.reply({
        content: '❌ O **link** precisa ser uma URL http/https válida.',
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

    const current = loadShopConfig();
    saveShopConfig({
      shopUrl: shopUrl || current.shopUrl || '',
      imageUrl: imageUrlOption || current.imageUrl || '',
      channelId: channel.id,
      guildId: interaction.guildId,
      staffIds: staffOption ? parseIdList(staffOption) : current.staffIds,
    });

    const files = [];
    const imageUrl = resolveBanner(imageUrlOption || loadShopConfig().imageUrl, files);

    await channel.send({
      flags: v2Flags(),
      components: [buildPublicShopContainer(imageUrl)],
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
      `✅ Loja enviada em ${channel}.\n🛒 **Comprar** abre um tópico privado com a embed da compra.`
    );
  },
};
