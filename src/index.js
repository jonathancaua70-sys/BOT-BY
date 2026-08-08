require('dotenv').config();
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const path = require('path');

const { testConnection } = require('./db');
const authRoutes = require('./routes/auth');
const discordClient = require('./discordClient');

// ===== API (Express) =====
const app = express();

// Configura trust proxy para Render
app.set('trust proxy', true);

app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(cookieParser());

// Serve arquivos estáticos da pasta public
app.use(express.static(path.join(__dirname, '../public')));

app.use('/api', authRoutes);

// Rota principal redireciona para login
app.get('/', (req, res) => {
  res.redirect('/login.html');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🌐 API rodando na porta ${PORT}`);
  console.log(`📱 Painel web disponível em http://localhost:${PORT}`);
});

// ===== Banco de dados =====
testConnection();

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
