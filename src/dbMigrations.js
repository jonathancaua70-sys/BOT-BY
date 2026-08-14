async function ensureColumn(pool, tableName, columnName, columnDefinition) {
  const safeTable = String(tableName).replace(/[^a-zA-Z0-9_]/g, '');
  const safeColumn = String(columnName).replace(/[^a-zA-Z0-9_]/g, '');

  try {
    await pool.query(
      `ALTER TABLE \`${safeTable}\` ADD COLUMN \`${safeColumn}\` ${columnDefinition}`
    );
    console.log(`✅ Coluna ${safeTable}.${safeColumn} adicionada`);
    return true;
  } catch (err) {
    if (err.code === 'ER_DUP_FIELDNAME' || String(err.message).includes('Duplicate column')) {
      return false;
    }
    throw err;
  }
}

async function migrateKeysTable(pool) {
  await ensureColumn(pool, 'keys_table', 'is_lifetime', 'TINYINT(1) NOT NULL DEFAULT 0');
  await ensureColumn(pool, 'keys_table', 'duration_days', 'INT NULL');
  await ensureColumn(pool, 'keys_table', 'creator_avatar', 'VARCHAR(512) NULL');
  await ensureColumn(pool, 'keys_table', 'panel_id', 'VARCHAR(50) NULL');
}

async function migrateLegacyUsersTable(pool) {
  const columns = [
    ['created_by', 'VARCHAR(100) NULL'],
    ['creator_avatar', 'VARCHAR(512) NULL'],
    ['creator_role', "VARCHAR(50) NULL DEFAULT 'member'"],
    ['user_avatar', 'VARCHAR(512) NULL'],
    ['hwid', 'VARCHAR(255) NULL'],
    ['hwid_history', 'JSON NULL'],
    ['expires_at', 'DATETIME NULL'],
    ['is_lifetime', 'TINYINT(1) NOT NULL DEFAULT 0'],
    ['updated_at', 'TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP'],
  ];

  for (const [name, definition] of columns) {
    await ensureColumn(pool, 'users', name, definition);
  }
}

async function runDatabaseMigrations(pool) {
  await migrateKeysTable(pool);
  await migrateLegacyUsersTable(pool);
}

module.exports = {
  ensureColumn,
  migrateKeysTable,
  migrateLegacyUsersTable,
  runDatabaseMigrations,
};
