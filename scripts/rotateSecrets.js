// Script CLI para rotação manual de secrets
const { initializeSecrets, rotateSecrets, forceRotation, getSecretsStatus } = require('../src/secretRotation');

const command = process.argv[2];

console.log('🔐 Sistema de Rotação de Secrets\n');

switch (command) {
  case 'init':
    console.log('Inicializando secrets...');
    initializeSecrets();
    break;
    
  case 'rotate':
    console.log('Rotacionando secrets...');
    forceRotation();
    break;
    
  case 'status':
    console.log('Status dos secrets:');
    const status = getSecretsStatus();
    console.log(JSON.stringify(status, null, 2));
    break;
    
  default:
    console.log('Uso:');
    console.log('  node scripts/rotateSecrets.js init    - Inicializa secrets (gera novos se não existirem)');
    console.log('  node scripts/rotateSecrets.js rotate  - Força rotação imediata dos secrets');
    console.log('  node scripts/rotateSecrets.js status  - Mostra status atual dos secrets');
    console.log('\nSecrets são salvos em .secrets.json');
    console.log('Backup é salvo em .secrets.backup.json');
    break;
}