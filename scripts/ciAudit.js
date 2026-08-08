// Script para CI/CD - Verifica vulnerabilidades e falha se encontrar críticas
const { execSync } = require('child_process');
const fs = require('fs');

console.log('🔍 Security Audit para CI/CD\n');

try {
  // Roda npm audit e salva output
  console.log('Executando npm audit...');
  const auditOutput = execSync('npm audit --json', { encoding: 'utf8' });
  const auditData = JSON.parse(auditOutput);
  
  // Verifica vulnerabilidades por severidade
  const vulnerabilities = auditData.vulnerabilities || {};
  const metadata = auditData.metadata || {};
  
  const critical = metadata.vulnerabilities?.critical || 0;
  const high = metadata.vulnerabilities?.high || 0;
  const moderate = metadata.vulnerabilities?.moderate || 0;
  const low = metadata.vulnerabilities?.low || 0;
  const info = metadata.vulnerabilities?.info || 0;
  
  console.log(`\n📊 Resumo de Vulnerabilidades:`);
  console.log(`  🔴 Críticas: ${critical}`);
  console.log(`  🟠 Altas: ${high}`);
  console.log(`  🟡 Moderadas: ${moderate}`);
  console.log(`  🟢 Baixas: ${low}`);
  console.log(`  ℹ️  Info: ${info}`);
  
  // Salva relatório
  const reportPath = 'security-audit-report.txt';
  fs.writeFileSync(reportPath, auditOutput);
  console.log(`\n💾 Relatório salvo em: ${reportPath}`);
  
  // Falha se houver vulnerabilidades críticas ou altas
  if (critical > 0 || high > 0) {
    console.error(`\n❌ CI/CD FAILED: ${critical} críticas + ${high} altas encontradas`);
    console.error('Execute "npm audit fix" para tentar corrigir automaticamente');
    process.exit(1);
  }
  
  // Avisa se houver moderadas
  if (moderate > 0) {
    console.warn(`\n⚠️  ${moderate} vulnerabilidades moderadas encontradas`);
    console.warn('Considere corrigir: npm audit fix');
  }
  
  console.log('\n✅ CI/CD PASSED: Nenhuma vulnerabilidade crítica ou alta');
  process.exit(0);
  
} catch (error) {
  // Se npm audit falhar (algumas versões do npm não suportam --json)
  console.warn('⚠️  npm audit --json não suportado, tentando método alternativo...');
  
  try {
    execSync('npm audit', { stdio: 'inherit' });
    console.log('\n✅ npm audit passou');
    process.exit(0);
  } catch (auditError) {
    console.error('\n❌ npm audit encontrou vulnerabilidades');
    process.exit(1);
  }
}