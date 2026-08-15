const fs = require('fs');
const path = require('path');

const configPath = path.join(__dirname, '../data/hooktrick-shop.json');

function defaultConfig() {
  return {
    shopUrl: process.env.HOOKTRICK_SHOP_URL || '',
    imageUrl: process.env.HOOKTRICK_IMAGE_URL || '',
    updatedAt: null,
  };
}

function loadShopConfig() {
  try {
    if (!fs.existsSync(configPath)) return defaultConfig();
    const raw = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    return { ...defaultConfig(), ...raw };
  } catch (_) {
    return defaultConfig();
  }
}

function saveShopConfig(partial) {
  const next = {
    ...loadShopConfig(),
    ...partial,
    updatedAt: new Date().toISOString(),
  };
  const dir = path.dirname(configPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify(next, null, 2), 'utf8');
  return next;
}

function isHttpUrl(value) {
  try {
    const url = new URL(String(value));
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch (_) {
    return false;
  }
}

module.exports = {
  loadShopConfig,
  saveShopConfig,
  isHttpUrl,
};
