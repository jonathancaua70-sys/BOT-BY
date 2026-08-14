const {
  SlashCommandBuilder,
  ChannelType,
  PermissionFlagsBits,
  MessageFlags,
} = require('discord.js');
const { joinVoiceChannel, getVoiceConnection } = require('@discordjs/voice');
const { logBotCommand } = require('../webhooks');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('connectar')
    .setDescription('Entra na call de voz (canal atual ou o canal escolhido)')
    .addChannelOption((option) =>
      option
        .setName('call')
        .setDescription('Canal de voz para o bot entrar')
        .addChannelTypes(ChannelType.GuildVoice, ChannelType.GuildStageVoice)
        .setRequired(false)
    ),

  async execute(interaction) {
    if (!interaction.guild) {
      return interaction.reply({
        content: '❌ Esse comando só funciona em um servidor.',
        flags: MessageFlags.Ephemeral,
      });
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
      const member = await interaction.guild.members.fetch(interaction.user.id);
      const chosen = interaction.options.getChannel('call');
      const voiceChannel = chosen || member.voice?.channel;

      if (!voiceChannel) {
        return interaction.editReply(
          '❌ Entra numa call primeiro, ou escolhe o canal na opção **call**.'
        );
      }

      const me = interaction.guild.members.me;
      const permissions = voiceChannel.permissionsFor(me);
      if (
        !permissions?.has(PermissionFlagsBits.Connect) ||
        !permissions?.has(PermissionFlagsBits.ViewChannel)
      ) {
        return interaction.editReply(
          `❌ Sem permissão para entrar em **${voiceChannel.name}**.`
        );
      }

      const existing = getVoiceConnection(interaction.guild.id);
      if (existing) {
        existing.destroy();
      }

      joinVoiceChannel({
        channelId: voiceChannel.id,
        guildId: interaction.guild.id,
        adapterCreator: interaction.guild.voiceAdapterCreator,
        selfDeaf: false,
        selfMute: true,
      });

      await logBotCommand(
        '/connectar',
        interaction.user.tag,
        interaction.guild.name,
        true,
        voiceChannel.name
      );

      return interaction.editReply(
        `🔊 Entrei na call **${voiceChannel.name}**.`
      );
    } catch (err) {
      console.error('Erro no /connectar:', err);
      return interaction.editReply('❌ Não consegui entrar na call. Confere as permissões do bot.');
    }
  },
};
