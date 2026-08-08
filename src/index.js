require('dotenv').config();
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const path = require('path');

const { testConnection } = require('./db');
const authRoutes = require('./routes/auth');
const discordClient = require('./discordClient');
const { logSiteAccess, logSystemError } = require('./webhooks');
const { provideCSRFToken, csrfProtection } = require('./csrf');
const { performBackup } = require('../scripts/backupDatabase');

// ===== API (Express) =====
const app = express();

// Configura trust proxy para Render
app.set('trust proxy', true);

// CORS configurado de forma mais restrita
const allowedOrigins = process.env.ALLOWED_ORIGINS 
  ? process.env.ALLOWED_ORIGINS.split(',') 
  : ['http://localhost:3000', 'http://127.0.0.1:3000'];

app.use(cors({
  origin: (origin, callback) => {
    // Permite requisições sem origin (como mobile apps, curl, etc.)
    if (!origin) return callback(null, true);
    
    // Verifica se origin está na whitelist
    if (allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      console.log(`🚫 CORS bloqueado: Origin ${origin} não permitido`);
      callback(new Error('Não permitido pelo CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Token'],
  maxAge: 86400 // 24 horas
}));
app.use(express.json());
app.use(cookieParser());

// Remove header x-powered-by que expõe tecnologia
app.disable('x-powered-by');

// Headers de segurança HTTP
app.use((req, res, next) => {
  // Proteção contra clickjacking
  res.setHeader('X-Frame-Options', 'DENY');
  
  // Previne sniffing de MIME type
  res.setHeader('X-Content-Type-Options', 'nosniff');
  
  // Habilita filtro XSS do navegador
  res.setHeader('X-XSS-Protection', '1; mode=block');
  
  // Política de segurança de conteúdo (removido unsafe-inline de script-src)
  res.setHeader('Content-Security-Policy', 
    "default-src 'self'; " +
    "script-src 'self' https://cdn.jsdelivr.net; " +
    "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; " +
    "img-src 'self' data: https://cdn.discordapp.com; " +
    "font-src 'self' https://cdn.jsdelivr.net; " +
    "connect-src 'self'; " +
    "frame-ancestors 'none';"
  );
  
  // Referrer Policy
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  
  // Permissions Policy - controla APIs do navegador
  res.setHeader('Permissions-Policy', 
    'geolocation=(), ' +
    'microphone=(), ' +
    'camera=(), ' +
    'payment=(), ' +
    'usb=(), ' +
    'magnetometer=(), ' +
    'gyroscope=(), ' +
    'accelerometer=()'
  );
  
  // Cross-Origin Opener Policy - protege contra window.opener access
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  
  // Cross-Origin Embedder Policy - requer COOP para funcionar corretamente
  res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
  
  // HSTS (apenas em produção com HTTPS)
  if (process.env.NODE_ENV === 'production') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
  }
  
  next();
});

// Serve arquivos estáticos da pasta public
app.use(express.static(path.join(__dirname, '../public')));

// Middleware de logging de acessos ao site
app.use(async (req, res, next) => {
  // Não loga requisições de arquivos estáticos e health checks
  if (req.path.startsWith('/static') || req.path.startsWith('/css') || req.path.startsWith('/js') || req.path.startsWith('/images')) {
    return next();
  }
  
  try {
    await logSiteAccess(req, req.path);
  } catch (err) {
    console.error('Erro ao logar acesso:', err);
  }
  
  next();
});

// Fornece CSRF token para requisições GET (para ser usado em requisições POST)
app.get('/api/csrf-token', provideCSRFToken, (req, res) => {
  res.json({ success: true, csrfToken: res.locals.csrfToken });
});

// Aplica CSRF protection nas rotas da API
app.use('/api', csrfProtection, authRoutes);

// Rota principal redireciona para login
app.get('/', (req, res) => {
  res.redirect('/login.html');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🌐 API rodando na porta ${PORT}`);
  console.log(`📱 Painel web disponível em http://localhost:${PORT}`);
});

// Middleware de captura de erros global
app.use(async (err, req, res, next) => {
  console.error('💥 Erro não tratado:', err);
  
  // Loga o erro no webhook
  try {
    await logSystemError(err, {
      path: req.path,
      method: req.method,
      ip: req.headers['x-forwarded-for'] || req.socket.remoteAddress,
      userAgent: req.headers['user-agent']
    });
  } catch (logErr) {
    console.error('Erro ao logar erro do sistema:', logErr);
  }
  
  // Responde com erro genérico ao cliente
  res.status(500).json({ 
    success: false, 
    message: 'Erro interno do servidor.' 
  });
});

// Captura exceções não tratadas
process.on('uncaughtException', async (err) => {
  console.error('💥 Exceção não capturada:', err);
  try {
    await logSystemError(err, { type: 'uncaughtException' });
  } catch (logErr) {
    console.error('Erro ao logar exceção não capturada:', logErr);
  }
});

// Captura rejeições de promise não tratadas
process.on('unhandledRejection', async (reason, promise) => {
  console.error('💥 Rejeição não tratada:', reason);
  try {
    await logSystemError(reason, { type: 'unhandledRejection', promise });
  } catch (logErr) {
    console.error('Erro ao logar rejeição não tratada:', logErr);
  }
});

// ===== Banco de dados =====
testConnection();

// ===== Backup Automatizado =====
// Faz backup do banco de dados diariamente às 3:00 AM
function scheduleBackup() {
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(3, 0, 0, 0); // 3:00 AM
  
  const msUntilBackup = tomorrow - now;
  
  console.log(`📅 Próximo backup agendado para: ${tomorrow.toISOString()}`);
  
  setTimeout(async () => {
    console.log('🔄 Executando backup agendado...');
    const result = await performBackup();
    
    if (result.success) {
      console.log('✅ Backup agendado concluído com sucesso');
    } else {
      console.error('❌ Backup agendado falhou:', result.error);
    }
    
    // Agenda o próximo backup
    scheduleBackup();
  }, msUntilBackup);
}

// Inicia o agendamento de backup
scheduleBackup();

// ===== Bot do Discord =====
async function loginDiscordWithRetry(maxRetries = 5, baseDelayMs = 5000) {
  // Verifica se o token está configurado
  if (!process.env.DISCORD_TOKEN) {
    console.error('❌ DISCORD_TOKEN não está definido no .env');
    return;
  }
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await discordClient.login(process.env.DISCORD_TOKEN);
      console.log('🤖 Bot do Discord conectado com sucesso');
      return;
    } catch (err) {
      const status = err?.status;
      console.error(`❌ Falha ao conectar o bot (tentativa ${attempt}/${maxRetries}):`, status || err.message);

      if (attempt === maxRetries) {
        console.error('🚫 Número máximo de tentativas atingido. O bot do Discord não foi conectado, mas a API continua no ar.');
        return;
      }

      // Backoff exponencial: 5s, 10s, 20s, 40s...
      const delay = baseDelayMs * Math.pow(2, attempt - 1);
      console.log(`⏳ Tentando novamente em ${delay / 1000}s...`);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}

loginDiscordWithRetry();
