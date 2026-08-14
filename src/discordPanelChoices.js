const { PANEL_IDS, getUsersTableName, isValidPanelId, getPanelConfig } = require('./panels');

function buildPlanoChoices() {
  return PANEL_IDS.map((panelId) => {
    const panel = getPanelConfig(panelId);
    return { name: panel.label, value: panel.id };
  });
}

function applyPlanoChoices(optionBuilder, { required = true } = {}) {
  optionBuilder
    .setName('plano')
    .setDescription('Plano do painel (External/Internal/DU7)')
    .setRequired(required);

  for (const choice of buildPlanoChoices()) {
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
    const labels = PANEL_IDS.map((id) => getPanelConfig(id)?.label).filter(Boolean).join(', ');
    return {
      ok: false,
      message: `❌ Plano inválido. Escolha: **${labels}**.`,
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
  buildPlanoChoices,
  applyPlanoChoices,
  applyPanelChoices,
  getPlanoFromInteraction,
  validatePlano,
  formatPlanoLabel,
};
