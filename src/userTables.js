const { PANEL_IDS, getUsersTableName } = require('./panels');

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
};
