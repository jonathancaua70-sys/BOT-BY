const fs = require('fs');
const path = require('path');

const configPath = path.join(__dirname, '../data/hooktrick-shop.json');

function defaultConfig() {
  return {
    shopUrl: process.env.HOOKTRICK_SHOP_URL || '',
    imageUrl: process.env.HOOKTRICK_IMAGE_URL || '',
    channelId: process.env.HOOKTRICK_CANAL_VENDAS || '',
    staffIds: parseIdList(process.env.HOOKTRICK_TOPIC_MEMBERS),
    updatedAt: null,
  };
}

function parseIdList(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  return String(value)
    .split(/[\s,;]+/)
    .map((id) => id.replace(/[<@!>]/g, '').trim())
    .filter((id) => /^\d{5,}$/.test(id));
}

function loadShopConfig() {
  try {
    if (!fs.existsSync(configPath)) return defaultConfig();
    const raw = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    const base = defaultConfig();
    return {
      ...base,
      ...raw,
      staffIds: parseIdList(raw.staffIds?.length ? raw.staffIds : base.staffIds),
    };
  } catch (_) {
    return defaultConfig();
  }
}

function saveShopConfig(partial) {
  const current = loadShopConfig();
  const next = {
    ...current,
    ...partial,
    staffIds: parseIdList(partial.staffIds ?? current.staffIds),
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

function getTopicStaffIds() {
  return loadShopConfig().staffIds || [];
}

module.exports = {
  loadShopConfig,
  saveShopConfig,
  isHttpUrl,
  parseIdList,
  getTopicStaffIds,
};
