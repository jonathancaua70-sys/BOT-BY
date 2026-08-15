const fs = require('fs');
const path = require('path');
const { Client, GatewayIntentBits, Collection, Events } = require('discord.js');
const { startBotPresence } = require('./botPresence');
const { handleHookTrickButton, handleHookTrickSelect } = require('./hookTrickBuy');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
  ],
});

client.commands = new Collection();

const commandsPath = path.join(__dirname, 'commands');
const commandFiles = fs.readdirSync(commandsPath).filter((file) => file.endsWith('.js'));

for (const file of commandFiles) {
  const command = require(path.join(commandsPath, file));
  client.commands.set(command.data.name, command);
}

async function registerGuildCommands(readyClient) {
  const guildId = process.env.GUILD_ID;
  if (!guildId) {
    console.warn('⚠️ GUILD_ID ausente — /connectar só aparece depois de rodar node src/deployCommands.js');
    return;
  }

  try {
    const payload = [...readyClient.commands.values()].map((command) => command.data);
    await readyClient.application.commands.set(payload, guildId);
    console.log(`✅ ${payload.length} comando(s) slash registrados no servidor`);
  } catch (err) {
    console.error('❌ Falha ao registrar comandos slash:', err.message);
  }
}

client.once(Events.ClientReady, async (c) => {
  console.log(`🤖 Bot online como ${c.user.tag}`);
  startBotPresence(c);
  await registerGuildCommands(c);
});

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (interaction.isButton() && String(interaction.customId || '').startsWith('hooktrick_')) {
      await handleHookTrickButton(interaction);
      return;
    }

    if (interaction.isStringSelectMenu() && String(interaction.customId || '').startsWith('hooktrick_')) {
      await handleHookTrickSelect(interaction);
      return;
    }

    if (!interaction.isChatInputCommand()) return;

    const command = interaction.client.commands.get(interaction.commandName);
    if (!command) return;

    await command.execute(interaction);
  } catch (err) {
    console.error(`Erro na interação:`, err);
    const errorMsg = { content: '❌ Ocorreu um erro ao executar isso.', flags: 64 };
    try {
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp(errorMsg);
      } else if (interaction.isRepliable()) {
        await interaction.reply(errorMsg);
      }
    } catch (_) {}
  }
});

module.exports = client;
