const fs = require('fs');
const path = require('path');
const { Client, GatewayIntentBits, Collection, Events } = require('discord.js');
const { startBotPresence } = require('./botPresence');

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
  if (!interaction.isChatInputCommand()) return;

  const command = interaction.client.commands.get(interaction.commandName);
  if (!command) return;

  try {
    await command.execute(interaction);
  } catch (err) {
    console.error(`Erro ao executar /${interaction.commandName}:`, err);
    const errorMsg = { content: '❌ Ocorreu um erro ao executar esse comando.', flags: 64 };
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(errorMsg);
    } else {
      await interaction.reply(errorMsg);
    }
  }
});

module.exports = client;
