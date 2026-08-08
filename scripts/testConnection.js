require('dotenv').config();
const mysql = require('mysql2/promise');

async function testConnection() {
    console.log('🔍 Testando conexão com o banco de dados...');
    console.log(`Host: ${process.env.DB_HOST}`);
    console.log(`User: ${process.env.DB_USER}`);
    console.log(`Database: ${process.env.DB_NAME}`);
    console.log(`SSL: ${process.env.DB_SSL}`);
    
    try {
        const connection = await mysql.createConnection({
            host: process.env.DB_HOST,
            port: Number(process.env.DB_PORT) || 3306,
            user: process.env.DB_USER,
            password: process.env.DB_PASSWORD,
            database: process.env.DB_NAME,
            ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
            connectTimeout: 30000
        });
        
        console.log('✅ Conexão estabelecida com sucesso!');
        
        // Testa uma query simples
        const [rows] = await connection.query('SELECT 1 as test');
        console.log('✅ Query test executada com sucesso:', rows);
        
        await connection.end();
        console.log('✅ Conexão encerrada');
        
    } catch (error) {
        console.error('❌ Erro na conexão:', error.message);
        console.error('Código do erro:', error.code);
        
        if (error.code === 'ETIMEDOUT') {
            console.log('\n⚠️  Possíveis causas:');
            console.log('  - Firewall bloqueando a conexão');
            console.log('  - Host ou porta incorretos');
            console.log('  - Problema de rede');
        } else if (error.code === 'ER_ACCESS_DENIED_ERROR') {
            console.log('\n⚠️  Credenciais incorretas (usuário ou senha)');
        } else if (error.code === 'ER_BAD_DB_ERROR') {
            console.log('\n⚠️  Banco de dados não existe');
        }
    }
}

testConnection();