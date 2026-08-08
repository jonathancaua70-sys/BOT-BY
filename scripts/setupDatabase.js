require('dotenv').config();
const { pool } = require('../src/db');

async function setupDatabase() {
    console.log('🔧 Configurando banco de dados...');
    
    try {
        // Cria tabela de usuários
        await pool.query(`
            CREATE TABLE IF NOT EXISTS users (
                id INT AUTO_INCREMENT PRIMARY KEY,
                username VARCHAR(50) NOT NULL UNIQUE,
                password VARCHAR(255) NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                INDEX idx_username (username)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
        console.log('✅ Tabela users criada com sucesso!');
        
        // Cria tabela de keys
        await pool.query(`
            CREATE TABLE IF NOT EXISTS keys_table (
                id INT AUTO_INCREMENT PRIMARY KEY,
                key_value VARCHAR(50) NOT NULL UNIQUE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                is_used BOOLEAN DEFAULT FALSE,
                used_by VARCHAR(50) NULL,
                used_at TIMESTAMP NULL,
                INDEX idx_key (key_value),
                INDEX idx_used (is_used)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
        console.log('✅ Tabela keys_table criada com sucesso!');
        
        // Verifica se já existe usuário admin
        const [existingUsers] = await pool.query(
            'SELECT COUNT(*) as count FROM users WHERE username = ?',
            ['admin']
        );
        
        if (existingUsers[0].count === 0) {
            // Insere usuário admin
            await pool.query(
                'INSERT INTO users (username, password) VALUES (?, ?)',
                ['admin', '$2a$10$s1730vSwly/4s0k9JiLfs.Pijq1wi4rt.rsxgs1CSGTcJCHx1PHN6']
            );
            console.log('✅ Usuário admin criado (senha: admin123)');
        } else {
            console.log('ℹ️  Usuário admin já existe');
        }
        
        // Insere keys de exemplo se não existirem
        const [existingKeys] = await pool.query('SELECT COUNT(*) as count FROM keys_table');
        
        if (existingKeys[0].count === 0) {
            const sampleKeys = [
                'AAAA-BBBB-CCCC-DDDD',
                'EEEE-FFFF-GGGG-HHHH',
                'IIII-JJJJ-KKKK-LLLL',
                'MMMM-NNNN-OOOO-PPPP',
                'QQQQ-RRRR-SSSS-TTTT'
            ];
            
            for (const key of sampleKeys) {
                await pool.query('INSERT INTO keys_table (key_value) VALUES (?)', [key]);
            }
            console.log('✅ 5 keys de exemplo criadas');
        } else {
            console.log('ℹ️  Keys já existem no banco');
        }
        
        // Mostra resumo
        const [users] = await pool.query('SELECT id, username, created_at FROM users');
        const [keys] = await pool.query('SELECT id, key_value, is_used FROM keys_table');
        
        console.log('\n📊 Resumo do banco de dados:');
        console.log(`Usuários: ${users.length}`);
        console.log(`Keys: ${keys.length}`);
        
        console.log('\n👤 Usuários:');
        users.forEach(user => {
            console.log(`  - ${user.username} (ID: ${user.id})`);
        });
        
        console.log('\n🔑 Keys disponíveis:');
        keys.filter(k => !k.is_used).forEach(key => {
            console.log(`  - ${key.key_value}`);
        });
        
        console.log('\n✅ Configuração do banco de dados concluída!');
        console.log('🔐 Login do dashboard: admin / admin123');
        
    } catch (error) {
        console.error('❌ Erro ao configurar banco de dados:', error.message);
        throw error;
    }
}

setupDatabase()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));