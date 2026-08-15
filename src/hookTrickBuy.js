const {
  ChannelType,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  ContainerBuilder,
  TextDisplayBuilder,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  MessageFlags,
  AttachmentBuilder,
} = require('discord.js');
const fs = require('fs');
const path = require('path');
const { loadShopConfig, getTopicStaffIds, isHttpUrl } = require('./hookTrickShop');

const BANNER_PATH = path.join(__dirname, '../assets/hooktrick-banner.png');
const BANNER_FULL_PATH = path.join(__dirname, '../assets/hooktrick-banner-full.png');

const COMPRAR_BUTTON_ID = 'hooktrick_comprar';
const PLANO_SELECT_ID = 'hooktrick_selecionar_plano';
const PAGAR_BUTTON_ID = 'hooktrick_ir_pagamento';
const CANCELAR_BUTTON_ID = 'hooktrick_cancelar_pedido';

const threadsPedidos = new Map();

const PLANOS = [
  { label: '1 Dia', value: '1-dia' },
  { label: '7 Dias', value: '7-dias' },
  { label: '30 Dias', value: '30-dias' },
  { label: 'Lifetime', value: 'lifetime' },
];

function v2Flags(extra = 0) {
  return MessageFlags.IsComponentsV2 | extra;
}

async function addTopicMembers(thread, memberIds = [], skipIds = []) {
  const skip = new Set(skipIds.map(String));
  const ids = [...new Set(memberIds.map(String))].filter((id) => id && !skip.has(id));
  for (const memberId of ids) {
    try {
      await thread.members.add(memberId);
    } catch (err) {
      console.error(`Erro ao adicionar ${memberId} no tópico:`, err.message);
    }
  }
}

function resolveBanner(imageUrl, files) {
  if (imageUrl) return imageUrl;
  const bannerFile = fs.existsSync(BANNER_PATH) ? BANNER_PATH : BANNER_FULL_PATH;
  if (fs.existsSync(bannerFile)) {
    files.push(new AttachmentBuilder(bannerFile, { name: 'hooktrick-banner.png' }));
    return 'attachment://hooktrick-banner.png';
  }
  return null;
}

function buildPublicShopContainer(imageUrl) {
  const container = new ContainerBuilder()
    .setAccentColor(0xffffff)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        [
          '# Hook Trick',
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
          'Não perca tempo! Compre agora e seja o mais temido do servidor.',
        ].join('\n')
      )
    )
    .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));

  if (imageUrl) {
    container.addMediaGalleryComponents(
      new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL(imageUrl))
    );
  }

  container
    .addTextDisplayComponents(new TextDisplayBuilder().setContent('-# Clique em **Comprar** para abrir seu tópico'))
    .addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(COMPRAR_BUTTON_ID)
          .setLabel('Comprar')
          .setEmoji('🛒')
          .setStyle(ButtonStyle.Success)
      )
    );

  return container;
}

function buildCarrinhoContainer({ userId, imageUrl, planoLabel }) {
  const container = new ContainerBuilder()
    .setAccentColor(0xffffff)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        [
          `# Hook Trick`,
          `<@${userId}>`,
          '',
          '**Revisão do pedido**',
          planoLabel ? `📦 Plano: **${planoLabel}**` : 'Escolha o plano abaixo para continuar.',
          '',
          'Staff já foi puxado neste tópico.',
        ].join('\n')
      )
    );

  if (imageUrl) {
    container.addMediaGalleryComponents(
      new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL(imageUrl))
    );
  }

  container.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(PLANO_SELECT_ID)
        .setPlaceholder('Selecione o plano')
        .addOptions(PLANOS.map((p) => ({ label: p.label, value: p.value })))
    )
  );

  const payRow = new ActionRowBuilder();
  const shopUrl = loadShopConfig().shopUrl;
  if (planoLabel && isHttpUrl(shopUrl)) {
    payRow.addComponents(
      new ButtonBuilder()
        .setLabel('Ir para o Pagamento')
        .setEmoji('✅')
        .setStyle(ButtonStyle.Link)
        .setURL(shopUrl)
    );
  } else if (planoLabel) {
    payRow.addComponents(
      new ButtonBuilder()
        .setCustomId(PAGAR_BUTTON_ID)
        .setLabel('Ir para o Pagamento')
        .setEmoji('✅')
        .setStyle(ButtonStyle.Success)
    );
  }
  payRow.addComponents(
    new ButtonBuilder()
      .setCustomId(CANCELAR_BUTTON_ID)
      .setLabel('Cancelar')
      .setEmoji('🗑️')
      .setStyle(ButtonStyle.Danger)
  );
  container.addActionRowComponents(payRow);

  return container;
}

async function openPurchaseThread(interaction) {
  const parent = interaction.channel.isThread()
    ? interaction.channel.parent
    : interaction.channel;

  if (!parent?.isTextBased() || typeof parent.threads?.create !== 'function') {
    return interaction.reply({
      content: '❌ Esse canal não aceita tópico privado. Coloca a loja num canal de texto.',
      flags: MessageFlags.Ephemeral,
    });
  }

  const existingId = threadsPedidos.get(interaction.user.id);
  if (existingId) {
    try {
      const existing = await interaction.client.channels.fetch(existingId);
      if (existing && !existing.archived) {
        return interaction.reply({
          content: `✅ Você já tem um tópico aberto: ${existing}`,
          flags: MessageFlags.Ephemeral,
        });
      }
    } catch (_) {
      threadsPedidos.delete(interaction.user.id);
    }
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const pedido = `${interaction.user.username}`.slice(0, 20);
  const thread = await parent.threads.create({
    name: `🛒 ${pedido} - Hook Trick`,
    type: ChannelType.PrivateThread,
    invitable: false,
    autoArchiveDuration: 1440,
  });

  await thread.members.add(interaction.user.id);
  await addTopicMembers(thread, getTopicStaffIds(), [interaction.user.id]);
  threadsPedidos.set(interaction.user.id, thread.id);

  const files = [];
  const imageUrl = resolveBanner(loadShopConfig().imageUrl, files);

  await thread.send({
    flags: v2Flags(),
    components: [buildCarrinhoContainer({ userId: interaction.user.id, imageUrl })],
    files,
  });

  return interaction.editReply({
    content: `✅ Seu carrinho foi criado.\n📋 **Ir para o tópico:** ${thread}`,
  });
}

async function handleHookTrickButton(interaction) {
  const id = interaction.customId;

  if (id === COMPRAR_BUTTON_ID) {
    return openPurchaseThread(interaction);
  }

  if (id === CANCELAR_BUTTON_ID) {
    await interaction.deferUpdate();
    threadsPedidos.delete(interaction.user.id);
    if (interaction.channel?.isThread()) {
      await interaction.channel.send({
        flags: v2Flags(),
        components: [
          new ContainerBuilder()
            .setAccentColor(0xffffff)
            .addTextDisplayComponents(
              new TextDisplayBuilder().setContent('# Pedido cancelado\nEste tópico será fechado.')
            ),
        ],
      });
      setTimeout(async () => {
        try {
          await interaction.channel.setArchived(true);
          await interaction.channel.setLocked(true);
        } catch (_) {}
      }, 1500);
    }
    return;
  }

  if (id === PAGAR_BUTTON_ID) {
    const shopUrl = loadShopConfig().shopUrl;
    return interaction.reply({
      content: isHttpUrl(shopUrl)
        ? `💳 Pagamento: ${shopUrl}`
        : '❌ Link de pagamento ainda não foi configurado. Use `/hook-trick configure`.',
      flags: MessageFlags.Ephemeral,
    });
  }
}

async function handleHookTrickSelect(interaction) {
  if (interaction.customId !== PLANO_SELECT_ID) return false;

  const value = interaction.values[0];
  const plano = PLANOS.find((p) => p.value === value);
  const files = [];
  const imageUrl = resolveBanner(loadShopConfig().imageUrl, files);

  await interaction.update({
    flags: v2Flags(),
    components: [
      buildCarrinhoContainer({
        userId: interaction.user.id,
        imageUrl,
        planoLabel: plano?.label || value,
      }),
    ],
    files,
  });
  return true;
}

module.exports = {
  COMPRAR_BUTTON_ID,
  buildPublicShopContainer,
  resolveBanner,
  v2Flags,
  handleHookTrickButton,
  handleHookTrickSelect,
};
