require('dotenv').config();
const { pool } = require('../src/db');
const { PANEL_IDS, getPanelConfig } = require('../src/panels');
const { ensureAllPanelUserTables } = require('../src/userTables');
const { ensureAllPanelKeyTables } = require('../src/keyTables');
const { runDatabaseMigrations } = require('../src/dbMigrations');

const ADMIN_HASH = '$2a$10$s1730vSwly/4s0k9JiLfs.Pijq1wi4rt.rsxgs1CSGTcJCHx1PHN6';

async function setupDatabase() {
    console.log('🔧 Configurando banco de dados...');

    try {
        // Tabela legada (dashboard antigo / compatibilidade)
        await pool.query(`
            CREATE TABLE IF NOT EXISTS users (
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
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
        console.log('✅ Tabela users (legado) criada/verificada');

        // Tabelas separadas por painel
        const panelTables = await ensureAllPanelUserTables(pool);
        for (const tableName of panelTables) {
            console.log(`✅ Tabela ${tableName} criada/verificada`);
        }

        // Tabelas de keys separadas por painel (keys_external-advanced, ...)
        const keyTables = await ensureAllPanelKeyTables(pool);
        for (const { tableName } of keyTables) {
            console.log(`✅ Tabela ${tableName} criada/verificada`);
        }

        await runDatabaseMigrations(pool);
        console.log('✅ Colunas extras verificadas (is_lifetime, duration_days, creator_avatar, panel_id)');

        // Admin na tabela internal-advanced (painel principal interno)
        const internalAdvanced = getPanelConfig('internal-advanced');
        if (internalAdvanced) {
            const [existingAdmin] = await pool.query(
                `SELECT COUNT(*) as count FROM \`${internalAdvanced.tableName}\` WHERE username = ?`,
                ['admin']
            );

            if (existingAdmin[0].count === 0) {
                await pool.query(
                    `INSERT INTO \`${internalAdvanced.tableName}\` (username, password, created_by, creator_role)
                     VALUES (?, ?, ?, ?)`,
                    ['admin', ADMIN_HASH, 'setup', 'admin']
                );
                console.log(`✅ Usuário admin criado em ${internalAdvanced.tableName} (senha: admin123)`);
            } else {
                console.log(`ℹ️  Usuário admin já existe em ${internalAdvanced.tableName}`);
            }
        }

        // Admin legado na tabela users
        const [legacyAdmin] = await pool.query(
            'SELECT COUNT(*) as count FROM users WHERE username = ?',
            ['admin']
        );
        if (legacyAdmin[0].count === 0) {
            await pool.query(
                'INSERT INTO users (username, password) VALUES (?, ?)',
                ['admin', ADMIN_HASH]
            );
            console.log('✅ Usuário admin criado em users (legado)');
        }

        const sampleKeysTable = 'keys_external-advanced';
        const [existingKeys] = await pool.query(
            `SELECT COUNT(*) as count FROM \`${sampleKeysTable}\``
        );

        if (existingKeys[0].count === 0) {
            const sampleKeys = [
                'AAAA-BBBB-CCCC-DDDD',
                'EEEE-FFFF-GGGG-HHHH',
                'IIII-JJJJ-KKKK-LLLL',
                'MMMM-NNNN-OOOO-PPPP',
                'QQQQ-RRRR-SSSS-TTTT'
            ];

            for (const key of sampleKeys) {
                await pool.query(
                    `INSERT INTO \`${sampleKeysTable}\` (key_value, panel_id) VALUES (?, ?)`,
                    [key, 'external-advanced']
                );
            }
            console.log(`✅ 5 keys de exemplo criadas em ${sampleKeysTable}`);
        } else {
            console.log('ℹ️  Keys de exemplo já existem no banco');
        }

        console.log('\n📊 Resumo das tabelas de usuários:');
        for (const panelId of PANEL_IDS) {
            const panel = getPanelConfig(panelId);
            const [rows] = await pool.query(
                `SELECT COUNT(*) as total FROM \`${panel.tableName}\``
            );
            console.log(`  - ${panel.tableName} (${panel.label}): ${rows[0].total} usuário(s)`);
        }

        console.log('\n📊 Resumo das tabelas de keys:');
        for (const { panelId, tableName } of keyTables) {
            const panel = getPanelConfig(panelId);
            const [rows] = await pool.query(
                `SELECT COUNT(*) as total FROM \`${tableName}\``
            );
            console.log(`  - ${tableName} (${panel.label}): ${rows[0].total} key(s)`);
        }

        const [legacyUsers] = await pool.query('SELECT COUNT(*) as total FROM users');
        console.log(`  - users (legado): ${legacyUsers[0].total} usuário(s)`);

        console.log('\n✅ Configuração do banco de dados concluída!');
        console.log('🔐 Login internal-advanced: admin / admin123');
        console.log('📋 Tabelas: users_external_advanced, users_external_premium, users_internal_advanced, users_internal_premium, users_du7');
        console.log('🔑 Tabelas de keys: keys_external-advanced, keys_external-premium, keys_internal-advanced, keys_internal-premium, keys_du7');
    } catch (error) {
        console.error('❌ Erro ao configurar banco de dados:', error.message);
        throw error;
    }
}

setupDatabase()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
