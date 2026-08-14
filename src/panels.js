const PANEL_IDS = [
  'external-advanced',
  'external-premium',
  'internal-advanced',
  'internal-premium',
  'du7',
];

function panelIdToTableName(panelId) {
  return `users_${String(panelId).replace(/-/g, '_')}`;
}

const PANELS = {
  'external-advanced': {
    id: 'external-advanced',
    label: 'External Advanced',
    loginBadge: 'Externo · Advanced',
    type: 'external',
    tier: 'advanced',
    description: 'Painel externo — tier Advanced',
    apiKeyEnv: 'EXTERNAL_ADVANCED_API_KEY',
    tableName: panelIdToTableName('external-advanced'),
  },
  'external-premium': {
    id: 'external-premium',
    label: 'External Premium',
    loginBadge: 'Externo · Premium',
    type: 'external',
    tier: 'premium',
    description: 'Painel externo — tier Premium',
    apiKeyEnv: 'EXTERNAL_PREMIUM_API_KEY',
    tableName: panelIdToTableName('external-premium'),
  },
  'internal-advanced': {
    id: 'internal-advanced',
    label: 'Internal Advanced',
    loginBadge: 'Interno · Advanced',
    type: 'internal',
    tier: 'advanced',
    description: 'Painel interno — tier Advanced',
    apiKeyEnv: 'INTERNAL_ADVANCED_API_KEY',
    tableName: panelIdToTableName('internal-advanced'),
  },
  'internal-premium': {
    id: 'internal-premium',
    label: 'Internal Premium',
    loginBadge: 'Interno · Premium',
    type: 'internal',
    tier: 'premium',
    description: 'Painel interno — tier Premium',
    apiKeyEnv: 'INTERNAL_PREMIUM_API_KEY',
    tableName: panelIdToTableName('internal-premium'),
  },
  du7: {
    id: 'du7',
    label: 'DU7',
    loginBadge: 'Plano · DU7',
    type: 'external',
    tier: 'du7',
    description: 'Plano DU7',
    apiKeyEnv: 'DU7_API_KEY',
    tableName: panelIdToTableName('du7'),
  },
};

function isValidPanelId(panelId) {
  return PANEL_IDS.includes(panelId);
}

function getPanelConfig(panelId) {
  return PANELS[panelId] || null;
}

function getPanelApiKey(panelId) {
  const panel = getPanelConfig(panelId);
  if (!panel) return null;

  const panelKey = process.env[panel.apiKeyEnv];
  if (panelKey) return panelKey;

  // Fallback global para painéis externos
  if (panel.type === 'external' && process.env.EXTERNAL_API_KEY) {
    return process.env.EXTERNAL_API_KEY;
  }

  return null;
}

function isExternalPanel(panelId) {
  const panel = getPanelConfig(panelId);
  return panel?.type === 'external';
}

function getUsersTableName(panelId) {
  const panel = getPanelConfig(panelId);
  return panel?.tableName || null;
}

function resolvePanelId(panelId) {
  if (panelId && isValidPanelId(panelId)) return panelId;
  return null;
}

function getAllPanelTables() {
  return PANEL_IDS.map((id) => {
    const panel = getPanelConfig(id);
    return {
      id: panel.id,
      label: panel.label,
      type: panel.type,
      tier: panel.tier,
      tableName: panel.tableName,
      loginPath: `/login/${panel.id}`,
      apiLoginPath: `/api/login/${panel.id}`,
    };
  });
}

module.exports = {
  PANEL_IDS,
  PANELS,
  panelIdToTableName,
  isValidPanelId,
  getPanelConfig,
  getPanelApiKey,
  isExternalPanel,
  getUsersTableName,
  resolvePanelId,
  getAllPanelTables,
};
