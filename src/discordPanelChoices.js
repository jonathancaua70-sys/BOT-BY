const { getUsersTableName, isValidPanelId, getPanelConfig } = require('./panels');

const PLANO_CHOICES = [
  { name: 'External Advanced', value: 'external-advanced' },
  { name: 'External Premium', value: 'external-premium' },
  { name: 'Internal Advanced', value: 'internal-advanced' },
  { name: 'Internal Premium', value: 'internal-premium' },
];

function applyPlanoChoices(optionBuilder, { required = true } = {}) {
  optionBuilder
    .setName('plano')
    .setDescription('Plano do painel (External/Internal · Advanced/Premium)')
    .setRequired(required);

  for (const choice of PLANO_CHOICES) {
    optionBuilder.addChoices(choice);
  }

  return optionBuilder;
}

/** @deprecated use applyPlanoChoices */
function applyPanelChoices(optionBuilder) {
  return applyPlanoChoices(optionBuilder, { required: true });
}

function getPlanoFromInteraction(interaction) {
  return interaction.options.getString('plano');
}

function validatePlano(plano) {
  if (!plano || !isValidPanelId(plano)) {
    return {
      ok: false,
      message:
        '❌ Plano inválido. Escolha: **External Advanced**, **External Premium**, **Internal Advanced** ou **Internal Premium**.',
    };
  }

  const usersTable = getUsersTableName(plano);
  if (!usersTable) {
    return { ok: false, message: '❌ Tabela do plano não encontrada no banco.' };
  }

  return {
    ok: true,
    panelId: plano,
    usersTable,
    panel: getPanelConfig(plano),
  };
}

function formatPlanoLabel(panelId) {
  const panel = getPanelConfig(panelId);
  return panel ? panel.label : panelId;
}

module.exports = {
  PLANO_CHOICES,
  applyPlanoChoices,
  applyPanelChoices,
  getPlanoFromInteraction,
  validatePlano,
  formatPlanoLabel,
};
