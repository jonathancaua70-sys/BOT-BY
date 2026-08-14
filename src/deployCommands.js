const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { REST, Routes } = require('discord.js');

const commands = [];
const commandsPath = path.join(__dirname, 'commands');
const commandFiles = fs.readdirSync(commandsPath).filter((file) => file.endsWith('.js'));

for (const file of commandFiles) {
  const command = require(path.join(commandsPath, file));
  commands.push(command.data.toJSON());
}

if (!process.env.DISCORD_TOKEN || !process.env.GUILD_ID) {
  console.error('❌ DISCORD_TOKEN ou GUILD_ID ausente no .env da raiz do bot.');
  process.exit(1);
}

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
const guildId = process.env.GUILD_ID;

function summarize(cmds) {
  return cmds.map((cmd) => {
    const opts = (cmd.options || []).map((o) => {
      const choices = (o.choices || []).map((c) => c.name).join(', ');
      return choices ? `${o.name} [${choices}]` : o.name;
    });
    return `/${cmd.name} → ${opts.join(' | ') || '(sem opções)'}`;
  });
}

(async () => {
  try {
    const appInfo = await rest.get(Routes.oauth2CurrentApplication());
    const appId = appInfo.id;

    if (process.env.CLIENT_ID && process.env.CLIENT_ID !== appId) {
      console.warn(`⚠️ CLIENT_ID no .env (${process.env.CLIENT_ID}) não bate com o token.`);
      console.warn(`   Usando o app do token: ${appId} (${appInfo.name})`);
    }

    console.log(`App: ${appId} (${appInfo.name})`);
    console.log(`Servidor: ${guildId}`);
    console.log(`Comandos locais (${commands.length}):`);
    summarize(commands).forEach((line) => console.log('  ' + line));

    console.log('\n🔄 Registrando no servidor (aparece na hora)...');
    try {
      const guildResult = await rest.put(Routes.applicationGuildCommands(appId, guildId), {
        body: commands,
      });

      console.log(`✅ Servidor atualizado (${guildResult.length} comando(s)):`);
      summarize(guildResult).forEach((line) => console.log('  ' + line));

      const missingPlano = guildResult.filter(
        (cmd) => !(cmd.options || []).some((o) => o.name === 'plano')
      );
      if (missingPlano.length) {
        console.warn(
          '⚠️ Sem opção plano:',
          missingPlano.map((c) => c.name).join(', ')
        );
      } else {
        console.log('✅ Todos os comandos no servidor têm a opção plano.');
      }
    } catch (guildErr) {
      if (guildErr.code === 50001) {
        console.error('❌ Missing Access: o bot não está nesse servidor, ou falta o scope applications.commands.');
        console.error(`   Convite: https://discord.com/oauth2/authorize?client_id=${appId}&permissions=8&scope=bot%20applications.commands`);
        console.error('   Depois de adicionar o bot, rode este script de novo.');
      } else {
        throw guildErr;
      }
    }

    console.log('\n🔄 Atualizando comandos globais (pode levar até 1h)...');
    await rest.put(Routes.applicationCommands(appId), { body: commands });
    console.log('✅ Comandos globais enviados.');

    console.log('\nNo Discord: Ctrl+R para recarregar, depois digite /gerarkey de novo.');
  } catch (err) {
    console.error('❌ Erro ao registrar comandos:', err);
    process.exit(1);
  }
})();
