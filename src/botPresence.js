const { ActivityType } = require('discord.js');
const { pool } = require('./db');
const { PANEL_IDS, getUsersTableName, getPanelConfig } = require('./panels');

const TWITCH_URL = process.env.TWITCH_URL || 'https://www.twitch.tv/discord';
const ROTATE_MS = Number(process.env.PRESENCE_ROTATE_MS) || 15_000;

let rotateTimer = null;
let stats = {
  apiOnline: true,
  dbOnline: false,
  users: 0,
  byPanel: {},
};

async function consultUserStats() {
  const byPanel = {};
  let users = 0;
  let dbOnline = false;

  try {
    await pool.query('SELECT 1');
    dbOnline = true;

    for (const panelId of PANEL_IDS) {
      const tableName = getUsersTableName(panelId);
      if (!tableName) {
        byPanel[panelId] = 0;
        continue;
      }
      try {
        const [rows] = await pool.query(
          `SELECT COUNT(*) AS total FROM \`${tableName}\``
        );
        const total = Number(rows[0]?.total) || 0;
        byPanel[panelId] = total;
        users += total;
      } catch (_) {
        byPanel[panelId] = 0;
      }
    }
  } catch (_) {
    dbOnline = false;
  }

  stats = {
    apiOnline: true,
    dbOnline,
    users,
    byPanel,
  };
  return stats;
}

function buildActivities() {
  const apiLabel = stats.dbOnline && stats.apiOnline ? 'API: Online' : 'API: Offline';
  const du7 = stats.byPanel.du7 || 0;
  const external =
    (stats.byPanel['external-advanced'] || 0) + (stats.byPanel['external-premium'] || 0);
  const internal =
    (stats.byPanel['internal-advanced'] || 0) + (stats.byPanel['internal-premium'] || 0);

  const names = [
    apiLabel,
    `${stats.users} usuário${stats.users === 1 ? '' : 's'}`,
    `Consultando usuários · ${stats.users}`,
    `DU7 ${du7} · Ext ${external} · Int ${internal}`,
  ];

  return names.map((name) => ({
    name,
    type: ActivityType.Streaming,
    url: TWITCH_URL,
  }));
}

function applyActivity(client, activity) {
  if (!client?.user) return;
  client.user.setPresence({
    status: stats.dbOnline ? 'online' : 'dnd',
    activities: [activity],
  });
}

function startBotPresence(client) {
  if (rotateTimer) {
    clearInterval(rotateTimer);
    rotateTimer = null;
  }

  let index = 0;

  const tick = async () => {
    try {
      await consultUserStats();
      const activities = buildActivities();
      applyActivity(client, activities[index % activities.length]);
      index += 1;
    } catch (err) {
      console.error('Erro ao atualizar presença do bot:', err.message);
    }
  };

  tick();
  rotateTimer = setInterval(tick, ROTATE_MS);
  console.log(`🟣 Presença Twitch (roxa) ativa — ${TWITCH_URL}`);
}

function getPresenceStats() {
  return { ...stats, byPanel: { ...stats.byPanel } };
}

function getPanelUserCountsLabel() {
  return PANEL_IDS.map((id) => {
    const label = getPanelConfig(id)?.label || id;
    return `${label}: ${stats.byPanel[id] || 0}`;
  }).join('\n');
}

module.exports = {
  startBotPresence,
  consultUserStats,
  getPresenceStats,
  getPanelUserCountsLabel,
};
