#!/usr/bin/env node

/**
 * Script de Penetration Testing Básico
 * Testa as medidas de segurança implementadas no sistema
 */

const http = require('http');
const https = require('https');
const crypto = require('crypto');

// Configuração
const BASE_URL = process.env.TEST_URL || 'http://localhost:3000';
const results = {
  passed: 0,
  failed: 0,
  warnings: 0,
  tests: []
};

// Cores para console
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m'
};

function logResult(test, status, message, details = '') {
  const statusIcon = status === 'PASS' ? '✅' : status === 'FAIL' ? '❌' : '⚠️';
  const color = status === 'PASS' ? colors.green : status === 'FAIL' ? colors.red : colors.yellow;
  
  console.log(`${color}${statusIcon} ${test}: ${status}${colors.reset}`);
  console.log(`   ${message}`);
  if (details) {
    console.log(`   ${details}`);
  }
  
  results.tests.push({ test, status, message, details });
  
  if (status === 'PASS') results.passed++;
  else if (status === 'FAIL') results.failed++;
  else results.warnings++;
}

function makeRequest(method, path, data = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    const options = {
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname + url.search,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...headers
      }
    };
    
    const req = (url.protocol === 'https:' ? https : http).request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        resolve({
          status: res.statusCode,
          headers: res.headers,
          body: body
        });
      });
    });
    
    req.on('error', reject);
    
    if (data) {
      req.write(JSON.stringify(data));
    }
    
    req.end();
  });
}

// TESTES DE SEGURANÇA

async function testSecurityHeaders() {
  console.log('\n🧪 Testando Headers de Segurança...');
  
  try {
    const response = await makeRequest('GET', '/');
    
    const tests = [
      {
        header: 'X-Frame-Options',
        expected: 'DENY',
        critical: true
      },
      {
        header: 'X-Content-Type-Options',
        expected: 'nosniff',
        critical: true
      },
      {
        header: 'X-XSS-Protection',
        expected: '1; mode=block',
        critical: true
      },
      {
        header: 'Content-Security-Policy',
        expected: "default-src 'self'",
        critical: true
      }
    ];
    
    for (const test of tests) {
      const value = response.headers[test.header.toLowerCase()];
      if (value && value.includes(test.expected)) {
        logResult(
          `Header ${test.header}`,
          'PASS',
          `Header configurado corretamente`,
          `Valor: ${value.substring(0, 50)}...`
        );
      } else {
        logResult(
          `Header ${test.header}`,
          test.critical ? 'FAIL' : 'WARNING',
          `Header não configurado ou incorreto`,
          value ? `Valor atual: ${value}` : 'Header ausente'
        );
      }
    }
  } catch (error) {
    logResult('Headers de Segurança', 'FAIL', 'Erro ao testar headers', error.message);
  }
}

async function testCSRFProtection() {
  console.log('\n🧪 Testando Proteção CSRF...');
  
  try {
    // Testa CSRF token endpoint
    const csrfResponse = await makeRequest('GET', '/api/csrf-token');
    
    if (csrfResponse.status === 200) {
      const body = JSON.parse(csrfResponse.body);
      if (body.success && body.csrfToken) {
        logResult('CSRF Token Endpoint', 'PASS', 'Endpoint fornece CSRF token');
        
        // Testa requisição sem CSRF token
        const loginResponse = await makeRequest('POST', '/api/login', {
          username: 'test',
          password: 'test'
        });
        
        if (loginResponse.status === 403) {
          logResult('CSRF Protection', 'PASS', 'Requisição sem CSRF token bloqueada');
        } else {
          logResult('CSRF Protection', 'FAIL', 'Requisição sem CSRF token não foi bloqueada');
        }
      } else {
        logResult('CSRF Token Endpoint', 'FAIL', 'CSRF token não fornecido');
      }
    } else {
      logResult('CSRF Token Endpoint', 'FAIL', 'Endpoint retornou status incorreto', `Status: ${csrfResponse.status}`);
    }
  } catch (error) {
    logResult('CSRF Protection', 'FAIL', 'Erro ao testar CSRF', error.message);
  }
}

async function testRateLimiting() {
  console.log('\n🧪 Testando Rate Limiting...');
  
  try {
    let blocked = false;
    let requestCount = 0;
    
    // Faz múltiplas requisições para testar rate limiting
    for (let i = 0; i < 15; i++) {
      const response = await makeRequest('POST', '/api/login', {
        username: 'test',
        password: 'test'
      });
      
      requestCount++;
      
      if (response.status === 429) {
        blocked = true;
        break;
      }
    }
    
    if (blocked) {
      logResult('Rate Limiting', 'PASS', `Rate limiting ativado após ${requestCount} tentativas`);
    } else {
      logResult('Rate Limiting', 'WARNING', 'Rate limiting não foi ativado após 15 tentativas');
    }
  } catch (error) {
    logResult('Rate Limiting', 'FAIL', 'Erro ao testar rate limiting', error.message);
  }
}

async function testInputValidation() {
  console.log('\n🧪 Testando Validação de Input...');
  
  try {
    // Testa XSS payload
    const xssPayload = {
      username: '<script>alert("xss")</script>',
      password: 'Admin123'
    };
    
    const response = await makeRequest('POST', '/api/login', xssPayload);
    
    if (response.status === 400) {
      logResult('XSS Protection', 'PASS', 'Input malicioso bloqueado');
    } else {
      logResult('XSS Protection', 'WARNING', 'Input malicioso não foi bloqueado', 'Verifique validação no servidor');
    }
    
    // Testa SQL injection
    const sqliPayload = {
      username: "admin' OR '1'='1",
      password: 'Admin123'
    };
    
    const sqliResponse = await makeRequest('POST', '/api/login', sqliPayload);
    
    if (sqliResponse.status === 401) {
      logResult('SQL Injection Protection', 'PASS', 'SQL injection não funcionou');
    } else {
      logResult('SQL Injection Protection', 'WARNING', 'SQL injection não foi prevenido');
    }
  } catch (error) {
    logResult('Input Validation', 'FAIL', 'Erro ao testar validação', error.message);
  }
}

async function testPasswordPolicy() {
  console.log('\n🧪 Testando Política de Senhas...');
  
  try {
    const weakPasswords = [
      { username: 'test1', password: '123' }, // Muito curta
      { username: 'test2', password: 'admin123' }, // Sem maiúscula
      { username: 'test3', password: 'ADMIN123' }, // Sem minúscula
      { username: 'test4', password: 'Adminabc' }, // Sem número
    ];
    
    let blockedCount = 0;
    
    for (const payload of weakPasswords) {
      const response = await makeRequest('POST', '/api/login', payload);
      if (response.status === 400) {
        blockedCount++;
      }
    }
    
    if (blockedCount === weakPasswords.length) {
      logResult('Password Policy', 'PASS', 'Todas as senhas fracas foram rejeitadas');
    } else {
      logResult('Password Policy', 'WARNING', `${blockedCount}/${weakPasswords.length} senhas fracas foram rejeitadas`);
    }
  } catch (error) {
    logResult('Password Policy', 'FAIL', 'Erro ao testar política de senhas', error.message);
  }
}

async function testCORS() {
  console.log('\n🧪 Testando Configuração CORS...');
  
  try {
    const response = await makeRequest('OPTIONS', '/', null, {
      'Origin': 'http://malicious-site.com',
      'Access-Control-Request-Method': 'POST'
    });
    
    const corsHeader = response.headers['access-control-allow-origin'];
    
    if (!corsHeader || corsHeader === 'null') {
      logResult('CORS Configuration', 'PASS', 'Origem maliciosa não permitida');
    } else if (corsHeader === '*') {
      logResult('CORS Configuration', 'FAIL', 'CORS permite qualquer origem (wildcard)');
    } else {
      logResult('CORS Configuration', 'WARNING', 'CORS permite origens específicas', `Origem: ${corsHeader}`);
    }
  } catch (error) {
    logResult('CORS Configuration', 'FAIL', 'Erro ao testar CORS', error.message);
  }
}

async function testInformationDisclosure() {
  console.log('\n🧪 Testando Divulgação de Informações...');
  
  try {
    const response = await makeRequest('GET', '/api/status');
    
    if (response.status === 200) {
      const body = JSON.parse(response.body);
      
      // Verifica se informações sensíveis estão expostas
      const sensitiveFields = ['password', 'secret', 'key', 'token'];
      const bodyString = JSON.stringify(body);
      
      let hasSensitiveInfo = false;
      for (const field of sensitiveFields) {
        if (bodyString.toLowerCase().includes(field)) {
          hasSensitiveInfo = true;
          break;
        }
      }
      
      if (!hasSensitiveInfo) {
        logResult('Information Disclosure', 'PASS', 'Nenhuma informação sensível exposta');
      } else {
        logResult('Information Disclosure', 'WARNING', 'Possível exposição de informações sensíveis');
      }
    }
  } catch (error) {
    logResult('Information Disclosure', 'FAIL', 'Erro ao testar divulgação', error.message);
  }
}

async function testErrorHandling() {
  console.log('\n🧪 Testando Tratamento de Erros...');
  
  try {
    // Testa endpoint inexistente
    const response = await makeRequest('GET', '/api/nonexistent');
    
    if (response.status === 404) {
      const body = JSON.parse(response.body);
      if (!body.stack && !body.error && !body.message.includes('Error')) {
        logResult('Error Handling', 'PASS', 'Erros não expõem stack trace');
      } else {
        logResult('Error Handling', 'WARNING', 'Erros podem expor informações internas');
      }
    } else {
      logResult('Error Handling', 'WARNING', 'Endpoint inexistente retornou status inesperado', `Status: ${response.status}`);
    }
  } catch (error) {
    logResult('Error Handling', 'FAIL', 'Erro ao testar tratamento de erros', error.message);
  }
}

async function testSessionSecurity() {
  console.log('\n🧪 Testando Segurança de Sessão...');
  
  try {
    const response = await makeRequest('GET', '/api/me');
    
    if (response.status === 401) {
      logResult('Session Security', 'PASS', 'Endpoint protegido requer autenticação');
    } else {
      logResult('Session Security', 'FAIL', 'Endpoint não requer autenticação');
    }
  } catch (error) {
    logResult('Session Security', 'FAIL', 'Erro ao testar segurança de sessão', error.message);
  }
}

// Executa todos os testes
async function runAllTests() {
  console.log('🔒 Iniciando Penetration Testing Básico');
  console.log(`🎯 Alvo: ${BASE_URL}`);
  console.log('⏰ Iniciado em:', new Date().toISOString());
  
  await testSecurityHeaders();
  await testCSRFProtection();
  await testRateLimiting();
  await testInputValidation();
  await testPasswordPolicy();
  await testCORS();
  await testInformationDisclosure();
  await testErrorHandling();
  await testSessionSecurity();
  
  // Resumo final
  console.log('\n' + '='.repeat(50));
  console.log('📊 RESUMO DOS TESTES');
  console.log('='.repeat(50));
  console.log(`✅ Passou: ${results.passed}`);
  console.log(`❌ Falhou: ${results.failed}`);
  console.log(`⚠️  Avisos: ${results.warnings}`);
  console.log(`📋 Total: ${results.tests.length}`);
  
  const successRate = ((results.passed / results.tests.length) * 100).toFixed(1);
  console.log(`🎯 Taxa de Sucesso: ${successRate}%`);
  
  if (results.failed === 0 && results.warnings <= 2) {
    console.log('\n🎉 Sistema está bem protegido!');
  } else if (results.failed === 0) {
    console.log('\n⚠️  Sistema está razoavelmente protegido, mas há melhorias possíveis.');
  } else {
    console.log('\n🚨 Sistema tem vulnerabilidades que precisam ser corrigidas.');
  }
  
  console.log('⏰ Finalizado em:', new Date().toISOString());
  
  // Salva resultados em arquivo
  const fs = require('fs');
  const reportPath = './security-test-report.json';
  fs.writeFileSync(reportPath, JSON.stringify(results, null, 2));
  console.log(`📄 Relatório salvo em: ${reportPath}`);
}

// Executa os testes
runAllTests().catch(error => {
  console.error('💥 Erro fatal nos testes:', error);
  process.exit(1);
});