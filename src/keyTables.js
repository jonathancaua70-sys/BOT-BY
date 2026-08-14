const { PANEL_IDS, getPanelConfig, resolvePanelId } = require('./panels');

// Nomes com hífen (keys_external-advanced, keys_external-premium, ...)
// MySQL exige backtick em tabelas com hífen — todas as queries abaixo usam.
function getKeyTableName(panelId) {
  const panel = getPanelConfig(panelId);
  if (!panel) return null;
  return `keys_${panel.id}`;
}

function getAllPanelKeyTables() {
  return PANEL_IDS
    .map((id) => {
      const tableName = getKeyTableName(id);
      if (!tableName) return null;
      return { panelId: id, tableName };
    })
    .filter(Boolean);
}

const KEY_TABLE_COLUMNS = `
  id INT AUTO_INCREMENT PRIMARY KEY,
  key_value VARCHAR(50) NOT NULL UNIQUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  is_used BOOLEAN DEFAULT FALSE,
  used_by VARCHAR(50) NULL,
  used_at TIMESTAMP NULL,
  is_lifetime TINYINT(1) NOT NULL DEFAULT 0,
  duration_days INT NULL,
  creator_avatar VARCHAR(512) NULL,
  panel_id VARCHAR(50) NULL,
  INDEX idx_key (key_value),
  INDEX idx_used (is_used)
`;

function buildCreateKeyTableSQL(tableName) {
  const safeName = String(tableName).replace(/[^a-zA-Z0-9_-]/g, '');
  return `
    CREATE TABLE IF NOT EXISTS \`${safeName}\` (
      ${KEY_TABLE_COLUMNS}
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `;
}

async function ensureKeyTable(pool, tableName) {
  await pool.query(buildCreateKeyTableSQL(tableName));
}

async function ensureAllPanelKeyTables(pool) {
  const created = [];

  for (const { panelId, tableName } of getAllPanelKeyTables()) {
    await ensureKeyTable(pool, tableName);
    created.push({ panelId, tableName });
  }

  return created;
}

const KEY_SELECT_COLUMNS =
  'id, key_value, created_at, is_used, used_by, used_at, is_lifetime, duration_days, creator_avatar, panel_id';

async function findKeyAcrossPanels(pool, keyValue) {
  for (const { panelId, tableName } of getAllPanelKeyTables()) {
    try {
      const [rows] = await pool.query(
        `SELECT ${KEY_SELECT_COLUMNS} FROM \`${tableName}\` WHERE key_value = ? LIMIT 1`,
        [keyValue]
      );
      if (rows[0]) {
        return {
          key: rows[0],
          tableName,
          panelId,
          panel: getPanelConfig(panelId),
        };
      }
    } catch (err) {
      if (err.code === 'ER_NO_SUCH_TABLE' || err.code === 'ER_BAD_FIELD_ERROR') {
        continue;
      }
      throw err;
    }
  }

  return null;
}

async function listKeysForPanel(pool, panelId) {
  const resolved = resolvePanelId(panelId);
  if (!resolved) return null;

  const tableName = getKeyTableName(resolved);
  if (!tableName) return null;

  const panel = getPanelConfig(resolved);

  const [rows] = await pool.query(
    `SELECT ${KEY_SELECT_COLUMNS} FROM \`${tableName}\` ORDER BY created_at DESC`
  );

  return rows.map((row) => ({
    ...row,
    panel: resolved,
    panel_label: panel.label,
    table: tableName,
  }));
}

async function listKeysFromAllPanels(pool) {
  const all = [];

  for (const panelId of PANEL_IDS) {
    try {
      const rows = await listKeysForPanel(pool, panelId);
      if (rows) all.push(...rows);
    } catch (err) {
      if (err.code === 'ER_NO_SUCH_TABLE' || err.code === 'ER_BAD_FIELD_ERROR') {
        continue;
      }
      throw err;
    }
  }

  return all;
}

module.exports = {
  getKeyTableName,
  getAllPanelKeyTables,
  buildCreateKeyTableSQL,
  ensureKeyTable,
  ensureAllPanelKeyTables,
  findKeyAcrossPanels,
  listKeysForPanel,
  listKeysFromAllPanels,
};
