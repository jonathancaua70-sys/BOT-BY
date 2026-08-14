const { PANEL_IDS, getUsersTableName, getPanelConfig, resolvePanelId } = require('./panels');

const USER_LOGIN_COLUMNS =
  'id, username, password, user_avatar, creator_avatar, hwid, hwid_history, expires_at, is_lifetime';

function getPanelTableTargets(panelId) {
  const resolved = resolvePanelId(panelId);
  if (resolved) {
    const tableName = getUsersTableName(resolved);
    if (!tableName) return [];
    return [{ panelId: resolved, tableName, legacy: false }];
  }

  const targets = PANEL_IDS.map((id) => ({
    panelId: id,
    tableName: getUsersTableName(id),
    legacy: false,
  })).filter((item) => item.tableName);

  targets.push({ panelId: null, tableName: 'users', legacy: true });
  return targets;
}

async function findUsersByUsername(pool, username, panelId) {
  const found = [];

  for (const target of getPanelTableTargets(panelId)) {
    try {
      const [rows] = await pool.query(
        `SELECT ${USER_LOGIN_COLUMNS} FROM \`${target.tableName}\` WHERE username = ? LIMIT 1`,
        [username]
      );
      if (rows[0]) {
        found.push({
          user: rows[0],
          panelId: target.panelId,
          tableName: target.tableName,
          legacy: target.legacy,
          panel: target.panelId ? getPanelConfig(target.panelId) : null,
        });
      }
    } catch (err) {
      if (err.code === 'ER_NO_SUCH_TABLE' || err.code === 'ER_BAD_FIELD_ERROR') {
        continue;
      }
      throw err;
    }
  }

  return found;
}

async function listUsersFromAllPanels(pool) {
  const all = [];

  for (const panelId of PANEL_IDS) {
    const panel = getPanelConfig(panelId);
    const tableName = getUsersTableName(panelId);
    if (!tableName) continue;

    try {
      const [rows] = await pool.query(
        `SELECT id, username, created_by, created_at, creator_avatar, creator_role, user_avatar, expires_at, is_lifetime
         FROM \`${tableName}\` ORDER BY created_at DESC`
      );

      for (const row of rows) {
        all.push({
          ...row,
          panel: panelId,
          panel_label: panel.label,
          table: tableName,
        });
      }
    } catch (err) {
      if (err.code === 'ER_NO_SUCH_TABLE' || err.code === 'ER_BAD_FIELD_ERROR') {
        continue;
      }
      throw err;
    }
  }

  return all;
}

const USER_TABLE_COLUMNS = `
  id INT AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(50) NOT NULL UNIQUE,
  password VARCHAR(255) NOT NULL,
  created_by VARCHAR(100) NULL,
  creator_avatar VARCHAR(512) NULL,
  creator_role VARCHAR(50) NULL DEFAULT 'member',
  user_avatar VARCHAR(512) NULL,
  hwid VARCHAR(255) NULL,
  hwid_history JSON NULL,
  expires_at DATETIME NULL,
  is_lifetime TINYINT(1) NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_username (username)
`;

function buildCreateTableSQL(tableName) {
  const safeName = String(tableName).replace(/[^a-zA-Z0-9_]/g, '');
  return `
    CREATE TABLE IF NOT EXISTS \`${safeName}\` (
      ${USER_TABLE_COLUMNS}
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `;
}

async function ensureUserTable(pool, tableName) {
  await pool.query(buildCreateTableSQL(tableName));
}

async function ensureAllPanelUserTables(pool) {
  const created = [];

  for (const panelId of PANEL_IDS) {
    const tableName = getUsersTableName(panelId);
    if (!tableName) continue;

    await ensureUserTable(pool, tableName);
    created.push(tableName);
  }

  return created;
}

module.exports = {
  buildCreateTableSQL,
  ensureUserTable,
  ensureAllPanelUserTables,
  getPanelTableTargets,
  findUsersByUsername,
  listUsersFromAllPanels,
};
