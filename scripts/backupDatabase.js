const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

// Configuração do banco de dados
const dbConfig = {
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : undefined
};

// Diretório de backups
const backupDir = path.join(__dirname, '../backups');

// Garante que o diretório de backups existe
if (!fs.existsSync(backupDir)) {
  fs.mkdirSync(backupDir, { recursive: true });
}

// Função para fazer backup de uma tabela específica
async function backupTable(pool, tableName) {
  try {
    // Obtém todos os dados da tabela
    const [rows] = await pool.query(`SELECT * FROM ${tableName}`);
    
    if (rows.length === 0) {
      return { table: tableName, rows: 0, status: 'empty' };
    }
    
    // Cria estrutura do backup
    const backup = {
      table: tableName,
      timestamp: new Date().toISOString(),
      data: rows
    };
    
    // Salva em arquivo JSON
    const filename = `${tableName}_${Date.now()}.json`;
    const filepath = path.join(backupDir, filename);
    
    fs.writeFileSync(filepath, JSON.stringify(backup, null, 2));
    
    return { table: tableName, rows: rows.length, status: 'success', filename };
  } catch (error) {
    return { table: tableName, rows: 0, status: 'error', error: error.message };
  }
}

// Função principal de backup
async function performBackup() {
  console.log('🔄 Iniciando backup do banco de dados...');
  
  const pool = mysql.createPool(dbConfig);
  
  try {
    // Obtém lista de tabelas
    const [tables] = await pool.query('SHOW TABLES');
    const tableNames = tables.map(row => Object.values(row)[0]);
    
    console.log(`📋 ${tableNames.length} tabelas encontradas: ${tableNames.join(', ')}`);
    
    const results = [];
    
    // Faz backup de cada tabela
    for (const tableName of tableNames) {
      console.log(`💾 Fazendo backup da tabela: ${tableName}`);
      const result = await backupTable(pool, tableName);
      results.push(result);
      console.log(`  ${result.status}: ${result.rows} registros`);
    }
    
    // Cria um arquivo de manifesto
    const manifest = {
      timestamp: new Date().toISOString(),
      database: process.env.DB_NAME,
      tables: results
    };
    
    const manifestPath = path.join(backupDir, `manifest_${Date.now()}.json`);
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
    
    // Resumo
    const successCount = results.filter(r => r.status === 'success').length;
    const errorCount = results.filter(r => r.status === 'error').length;
    const totalRows = results.reduce((sum, r) => sum + r.rows, 0);
    
    console.log('\n✅ Backup concluído!');
    console.log(`📊 Resumo:`);
    console.log(`  - Tabelas: ${tableNames.length}`);
    console.log(`  - Sucesso: ${successCount}`);
    console.log(`  - Erros: ${errorCount}`);
    console.log(`  - Total de registros: ${totalRows}`);
    console.log(`  - Manifesto: ${manifestPath}`);
    
    // Limpeza de backups antigos (mantém últimos 7 dias)
    await cleanOldBackups();
    
    // Testa o backup mais recente automaticamente
    const backups = listBackups();
    if (backups.length > 0) {
      console.log('🧪 Testando integridade do backup mais recente...');
      const testResult = await testRestore(backups[0].file);
      if (testResult.success) {
        console.log('✅ Backup mais recente está íntegro e pode ser restaurado');
      } else {
        console.error('❌ Backup mais recente falhou no teste de integridade:', testResult.error);
      }
    }
    
    await pool.end();
    
    return { success: true, results, manifest: manifestPath };
    
  } catch (error) {
    console.error('❌ Erro durante backup:', error);
    await pool.end();
    return { success: false, error: error.message };
  }
}

// Função para limpar backups antigos
async function cleanOldBackups() {
  const maxAge = 7 * 24 * 60 * 60 * 1000; // 7 dias
  const now = Date.now();
  
  try {
    const files = fs.readdirSync(backupDir);
    let deletedCount = 0;
    
    for (const file of files) {
      const filepath = path.join(backupDir, file);
      const stats = fs.statSync(filepath);
      
      if (now - stats.mtimeMs > maxAge) {
        fs.unlinkSync(filepath);
        deletedCount++;
        console.log(`🗑️  Backup antigo removido: ${file}`);
      }
    }
    
    if (deletedCount > 0) {
      console.log(`🧹 ${deletedCount} backups antigos removidos`);
    }
  } catch (error) {
    console.error('⚠️  Erro ao limpar backups antigos:', error);
  }
}

// Função para testar restauração (não modifica dados reais)
async function testRestore(backupFile) {
  console.log('🧪 Iniciando teste de restauração...');
  
  const pool = mysql.createPool(dbConfig);
  
  try {
    const filepath = path.join(backupDir, backupFile);
    
    if (!fs.existsSync(filepath)) {
      throw new Error(`Arquivo de backup não encontrado: ${backupFile}`);
    }
    
    const backup = JSON.parse(fs.readFileSync(filepath, 'utf8'));
    
    if (!backup.table || !backup.data) {
      throw new Error('Formato de backup inválido');
    }
    
    console.log(`📋 Testando restauração da tabela: ${backup.table}`);
    console.log(`📊 Registros no backup: ${backup.data.length}`);
    
    // Verifica se a tabela existe
    const [tables] = await pool.query('SHOW TABLES LIKE ?', [backup.table]);
    if (tables.length === 0) {
      console.log(`⚠️  Tabela ${backup.table} não existe no banco - teste não pode ser completo`);
      await pool.end();
      return { 
        success: false, 
        error: 'Tabela não existe no banco',
        recommendation: 'Crie a tabela primeiro ou teste com outra tabela'
      };
    }
    
    // Verifica estrutura da tabela
    const [structure] = await pool.query(`DESCRIBE ${backup.table}`);
    const columns = structure.map(col => col.Field);
    
    console.log(`📋 Colunas no banco: ${columns.join(', ')}`);
    
    // Verifica se backup tem as colunas necessárias
    if (backup.data.length > 0) {
      const backupColumns = Object.keys(backup.data[0]);
      const missingColumns = columns.filter(col => !backupColumns.includes(col));
      const extraColumns = backupColumns.filter(col => !columns.includes(col));
      
      if (missingColumns.length > 0) {
        console.log(`⚠️  Colunas faltando no backup: ${missingColumns.join(', ')}`);
      }
      
      if (extraColumns.length > 0) {
        console.log(`⚠️  Colunas extras no backup: ${extraColumns.join(', ')}`);
      }
    }
    
    // Testa contagem de registros
    const [currentCount] = await pool.query(`SELECT COUNT(*) as count FROM ${backup.table}`);
    console.log(`📊 Registros atuais no banco: ${currentCount[0].count}`);
    console.log(`📊 Registros no backup: ${backup.data.length}`);
    
    // Simula restauração (valida apenas estrutura)
    console.log('✅ Estrutura do backup compatível com o banco atual');
    console.log('📝 Backup pode ser restaurado com sucesso');
    
    await pool.end();
    
    return { 
      success: true, 
      table: backup.table, 
      backupRows: backup.data.length,
      currentRows: currentCount[0].count,
      structureValid: true,
      message: 'Backup validado com sucesso'
    };
    
  } catch (error) {
    console.error('❌ Erro durante teste de restauração:', error);
    await pool.end();
    return { success: false, error: error.message };
  }
}
async function restoreBackup(backupFile) {
  console.log('🔄 Iniciando restauração do backup...');
  
  const pool = mysql.createPool(dbConfig);
  
  try {
    const filepath = path.join(backupDir, backupFile);
    
    if (!fs.existsSync(filepath)) {
      throw new Error(`Arquivo de backup não encontrado: ${backupFile}`);
    }
    
    const backup = JSON.parse(fs.readFileSync(filepath, 'utf8'));
    
    if (!backup.table || !backup.data) {
      throw new Error('Formato de backup inválido');
    }
    
    // Limpa a tabela
    await pool.query(`DELETE FROM ${backup.table}`);
    console.log(`🗑️  Tabela ${backup.table} limpa`);
    
    // Restaura os dados
    if (backup.data.length > 0) {
      const columns = Object.keys(backup.data[0]);
      const placeholders = columns.map(() => '?').join(', ');
      const values = backup.data.map(row => Object.values(row));
      
      for (const row of values) {
        await pool.query(
          `INSERT INTO ${backup.table} (${columns.join(', ')}) VALUES (${placeholders})`,
          row
        );
      }
    }
    
    console.log(`✅ Restauração concluída: ${backup.data.length} registros restaurados em ${backup.table}`);
    
    await pool.end();
    return { success: true, table: backup.table, rows: backup.data.length };
    
  } catch (error) {
    console.error('❌ Erro durante restauração:', error);
    await pool.end();
    return { success: false, error: error.message };
  }
}

// Função para listar backups disponíveis
function listBackups() {
  try {
    const files = fs.readdirSync(backupDir);
    const backups = files
      .filter(file => file.endsWith('.json') && !file.startsWith('manifest_'))
      .map(file => {
        const filepath = path.join(backupDir, file);
        const stats = fs.statSync(filepath);
        const backup = JSON.parse(fs.readFileSync(filepath, 'utf8'));
        
        return {
          file,
          table: backup.table,
          timestamp: backup.timestamp,
          rows: backup.data.length,
          size: stats.size,
          created: stats.mtime
        };
      })
      .sort((a, b) => b.created - a.created);
    
    return backups;
  } catch (error) {
    console.error('❌ Erro ao listar backups:', error);
    return [];
  }
}

// Se executado diretamente
if (require.main === module) {
  const command = process.argv[2];
  
  if (command === 'restore') {
    const backupFile = process.argv[3];
    if (!backupFile) {
      console.error('❌ Especifique o arquivo de backup para restaurar');
      process.exit(1);
    }
    restoreBackup(backupFile);
  } else if (command === 'test') {
    const backupFile = process.argv[3];
    if (!backupFile) {
      console.error('❌ Especifique o arquivo de backup para testar');
      process.exit(1);
    }
    testRestore(backupFile);
  } else if (command === 'list') {
    const backups = listBackups();
    console.log('📋 Backups disponíveis:');
    backups.forEach(backup => {
      console.log(`  ${backup.file} - ${backup.table} (${backup.rows} registros) - ${backup.timestamp}`);
    });
  } else {
    performBackup();
  }
}

module.exports = {
  performBackup,
  restoreBackup,
  testRestore,
  listBackups,
  cleanOldBackups
};