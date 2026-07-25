require('dotenv').config();
const express = require('express');
const cors = require('cors');

const { testConnection } = require('./db');
const authRoutes = require('./routes/auth');
const discordClient = require('./discordClient');

// ===== API (Express) =====
const app = express();
app.use(cors());
app.use(express.json());

app.use('/api', authRoutes);

app.get('/', (req, res) => {
  res.send('🤖 API do bot está online.');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🌐 API rodando na porta ${PORT}`);
});

// ===== Banco de dados =====
testConnection();

// ===== Bot do Discord =====
discordClient.login(process.env.DISCORD_TOKEN);
