// ============================================================
// export.js — Exportación e importación de datos JSON
// Dependencias: state.js, utils.js
// ============================================================

function getExportScope() {
  const radios = document.querySelectorAll('input[name="export-scope"]');
  for (const r of radios) { if (r.checked) return r.value; }
  return 'all';
}

function getDateRange() {
  const scope = getExportScope();
  const today = todayStr();

  if (scope === 'today') {
    return { from: today, to: today };
  }
  if (scope === 'range') {
    const from = document.getElementById('export-date-from').value;
    const to   = document.getElementById('export-date-to').value;
    return { from: from || today, to: to || today };
  }
  const pid = currentProfile.id;
  const prefix = `nutre_foods_${pid}_`;
  const expPrefix = `nutre_exercises_${pid}_`;
  let dates = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k.startsWith(prefix)) dates.push(k.replace(prefix, ''));
    if (k.startsWith(expPrefix)) dates.push(k.replace(expPrefix, ''));
  }
  dates = [...new Set(dates)].sort();
  if (dates.length === 0) return { from: today, to: today };
  return { from: dates[0], to: dates[dates.length - 1] };
}

function getDatesInRange(from, to) {
  const dates = [];
  const cur = new Date(from + 'T12:00:00');
  const end = new Date(to   + 'T12:00:00');
  while (cur <= end) {
    dates.push(cur.toISOString().split('T')[0]);
    cur.setDate(cur.getDate() + 1);
  }
  return dates;
}

function updateExportPreview() {
  const scope = getExportScope();
  const rangeInputs = document.getElementById('export-range-inputs');
  if (rangeInputs) rangeInputs.style.display = scope === 'range' ? 'flex' : 'none';

  const incFoods     = document.getElementById('export-include-foods')?.checked;
  const incExercises = document.getElementById('export-include-exercises')?.checked;
  const incSaved     = document.getElementById('export-include-saved')?.checked;

  const { from, to } = getDateRange();
  const dates = getDatesInRange(from, to);
  const pid = currentProfile.id;

  let foodCount = 0, exerciseCount = 0;
  dates.forEach(ds => {
    if (incFoods)     foodCount     += (getStorage(getFoodsKey(pid, ds)) || []).length;
    if (incExercises) exerciseCount += (getStorage(getExercisesKey(pid, ds)) || []).length;
  });

  const savedCount = incSaved ? (currentProfile.savedFoods || []).length : 0;

  const parts = [];
  if (incFoods)     parts.push(`${foodCount} comidas`);
  if (incExercises) parts.push(`${exerciseCount} ejercicios`);
  if (incSaved)     parts.push(`${savedCount} comidas guardadas`);

  const preview = document.getElementById('export-preview');
  if (!preview) return;

  if (parts.length === 0) {
    preview.textContent = 'Seleccioná al menos un tipo de dato.';
    return;
  }

  const rangeLabel = from === to ? from : `${from} → ${to}` ;
  preview.textContent = `${rangeLabel} · ${parts.join(' · ')}`;
}

function exportData() {
  const incFoods     = document.getElementById('export-include-foods')?.checked;
  const incExercises = document.getElementById('export-include-exercises')?.checked;
  const incSaved     = document.getElementById('export-include-saved')?.checked;

  if (!incFoods && !incExercises && !incSaved) {
    showToast('Seleccioná al menos un tipo de dato');
    return;
  }

  const { from, to } = getDateRange();
  const dates = getDatesInRange(from, to);
  const pid = currentProfile.id;

  const payload = {
    version: 2,
    exportedAt: new Date().toISOString(),
    profileId: pid,
    profileName: currentProfile.name,
    dateRange: { from, to },
    foods: {},
    exercises: {},
    savedFoods: [],
  };

  dates.forEach(ds => {
    if (incFoods) {
      const f = getStorage(getFoodsKey(pid, ds)) || [];
      if (f.length > 0) payload.foods[ds] = f;
    }
    if (incExercises) {
      const e = getStorage(getExercisesKey(pid, ds)) || [];
      if (e.length > 0) payload.exercises[ds] = e;
    }
  });

  if (incSaved) payload.savedFoods = currentProfile.savedFoods || [];

  const json = JSON.stringify(payload, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');

  const scope = getExportScope();
  const suffix = scope === 'today' ? todayStr()
               : scope === 'range' ? `${from}_${to}`
               : 'completo';
  a.href = url;
  a.download = `nutre_${currentProfile.name.toLowerCase().replace(/\s+/g, '_')}_${suffix}.json`;
  a.click();
  URL.revokeObjectURL(url);
  showToast('Archivo descargado');
}

// ===== IMPORT =====

function handleImportFile(event) {
  const file = event.target.files[0];
  if (!file) return;

  const label = document.getElementById('import-file-label-text');
  if (label) label.textContent = file.name;

  const reader = new FileReader();
  reader.onload = (ev) => {
    try {
      const data = JSON.parse(ev.target.result);
      if (!data.version || !data.foods) {
        showToast('Archivo inválido o formato incorrecto');
        return;
      }
      pendingImportData = data;

      const foodDates   = Object.keys(data.foods || {});
      const exDates     = Object.keys(data.exercises || {});
      const foodCount   = Object.values(data.foods || {}).reduce((s, a) => s + a.length, 0);
      const exCount     = Object.values(data.exercises || {}).reduce((s, a) => s + a.length, 0);
      const savedCount  = (data.savedFoods || []).length;

      const lines = [];
      if (foodCount)   lines.push(`${foodCount} comidas en ${foodDates.length} días`);
      if (exCount)     lines.push(`${exCount} ejercicios en ${exDates.length} días`);
      if (savedCount)  lines.push(`${savedCount} comidas guardadas`);
      if (data.dateRange) lines.push(`Rango: ${data.dateRange.from} → ${data.dateRange.to}`);
      lines.push(`Exportado por: ${data.profileName || '—'}`);

      const preview = document.getElementById('import-preview');
      if (preview) { preview.innerHTML = lines.join('<br>'); preview.style.display = 'block'; }

      const confirmBtn = document.getElementById('import-confirm-btn');
      if (confirmBtn) confirmBtn.style.display = 'flex';

    } catch {
      showToast('Error al leer el archivo');
      pendingImportData = null;
    }
  };
  reader.readAsText(file);
}

function confirmImport() {
  if (!pendingImportData) return;
  const data = pendingImportData;
  const pid  = currentProfile.id;

  let foodsImported = 0, exImported = 0, savedImported = 0, skipped = 0;

  Object.entries(data.foods || {}).forEach(([ds, incoming]) => {
    const existing = getStorage(getFoodsKey(pid, ds)) || [];
    const existingIds = new Set(existing.map(f => f.id));
    const toAdd = incoming.filter(f => !existingIds.has(f.id));
    if (toAdd.length > 0) {
      saveFoods(ds, [...existing, ...toAdd]);
      foodsImported += toAdd.length;
    }
    skipped += incoming.length - toAdd.length;
  });

  Object.entries(data.exercises || {}).forEach(([ds, incoming]) => {
    const existing = getStorage(getExercisesKey(pid, ds)) || [];
    const existingIds = new Set(existing.map(e => e.id));
    const toAdd = incoming.filter(e => !existingIds.has(e.id));
    if (toAdd.length > 0) {
      saveExercises(ds, [...existing, ...toAdd]);
      exImported += toAdd.length;
    }
    skipped += incoming.length - toAdd.length;
  });

  const incomingSaved = data.savedFoods || [];
  if (incomingSaved.length > 0) {
    const profiles = getProfiles();
    const p = profiles[pid];
    if (!p.savedFoods) p.savedFoods = [];
    const existingNames = new Set(p.savedFoods.map(f => f.name));
    const toAdd = incomingSaved.filter(f => !existingNames.has(f.name));
    p.savedFoods.push(...toAdd);
    savedImported = toAdd.length;
    saveProfiles(profiles);
    currentProfile = profiles[pid];
  }

  pendingImportData = null;
  const preview = document.getElementById('import-preview');
  if (preview) { preview.style.display = 'none'; preview.innerHTML = ''; }
  const confirmBtn = document.getElementById('import-confirm-btn');
  if (confirmBtn) confirmBtn.style.display = 'none';
  const fileInput = document.getElementById('import-file-input');
  if (fileInput) fileInput.value = '';
  const labelText = document.getElementById('import-file-label-text');
  if (labelText) labelText.textContent = 'Seleccionar archivo .json';

  const parts = [];
  if (foodsImported)  parts.push(`${foodsImported} comidas`);
  if (exImported)     parts.push(`${exImported} ejercicios`);
  if (savedImported)  parts.push(`${savedImported} comidas guardadas`);
  if (skipped > 0)    parts.push(`${skipped} ya existentes omitidos`);

  showToast('Importado: ' + (parts.join(' · ') || 'Sin datos nuevos'));

  renderHome();
  updateExportPreview();
}
