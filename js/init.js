// ============================================================
// init.js — Bootstrap de la aplicación y monkey-patch de
//           renderSettings para export/import
// Dependencias: todos los archivos anteriores
// ============================================================

window.addEventListener('load', () => {
  initTheme();
  const id = getActiveProfileId();
  const profiles = getProfiles();
  if (id && profiles[id]) loadApp();
  else showSetup();
});

// Monkey-patch renderSettings para inicializar datepickers de exportación
const _origRenderSettings = renderSettings;
renderSettings = function() {
  _origRenderSettings();
  const today = todayStr();
  const fromEl = document.getElementById('export-date-from');
  const toEl   = document.getElementById('export-date-to');
  if (fromEl && !fromEl.value) fromEl.value = today;
  if (toEl   && !toEl.value)   toEl.value   = today;
  updateExportPreview();
};
