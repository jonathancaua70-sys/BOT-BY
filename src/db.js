const mysql = require('mysql2/promise');
const { ensureAllPanelUserTables } = require('./userTables');
const { runDatabaseMigrations } = require('./dbMigrations');

// Pool de conexões: reaproveita conexões em vez de abrir uma nova a cada consulta
const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  // O Aiven exige conexão via SSL. rejectUnauthorized:false evita erro de
  // certificado self-signed. Para máxima segurança, baixe o ca.pem do Aiven
  // e troque por: ssl: { ca: fs.readFileSync('ca.pem') }
  ssl:
    process.env.DB_SSL === 'true'
      ? { rejectUnauthorized: false }
      : undefined,
});

async function testConnection() {
  try {
    const conn = await pool.getConnection();
    console.log('✅ Conectado ao MySQL (Aiven) com sucesso!');

    const tables = await ensureAllPanelUserTables(pool);
    console.log(`✅ Tabelas de painel verificadas: ${tables.join(', ')}`);

    await runDatabaseMigrations(pool);
    console.log('✅ Migrações do banco verificadas (keys_table, users)');

    conn.release();
  } catch (err) {
    console.error('❌ Erro ao conectar no banco de dados:', err.message);
  }
}

module.exports = { pool, testConnection };
