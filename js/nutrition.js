// ============================================================
// nutrition.js — Cálculos de TDEE, metas, macros, y goal preview
// Dependencias: state.js, utils.js
// ============================================================

// Calcula TDEE usando Mifflin-St Jeor
function calcTDEE(profile) {
  const { weight, height, age, sex, activity } = profile;
  let bmr;
  if (sex === 'm') bmr = 10 * weight + 6.25 * height - 5 * age + 5;
  else bmr = 10 * weight + 6.25 * height - 5 * age - 161;
  return Math.round(bmr * parseFloat(activity));
}

// Calorías mínimas seguras (basado en proteína 2g/kg + grasa 0.8g/kg)
function getMinCalories(profile) {
  const weight = Number(profile?.weight) || 0;
  if (weight <= 0) return 1200;
  const minProtein = Math.round(weight * 2.0);
  const minFat = Math.round(weight * 0.8);
  return Math.max(1200, minProtein * 4 + minFat * 9);
}

// Calcula el offset de meta (déficit/superávit) asegurando mínimo calórico
function getGoalOffset(profile) {
  const minKcal = getMinCalories(profile);
  const base = typeof profile?.tdee === 'number' ? profile.tdee : 0;
  const minOffset = base > 0 ? Math.round(minKcal - base) : -1000;

  if (profile && typeof profile.goalOffset === 'number' && !Number.isNaN(profile.goalOffset)) {
    return clamp(profile.goalOffset, minOffset, 1000);
  }
  if (profile && typeof profile.goal === 'number' && typeof profile.tdee === 'number') {
    return clamp(profile.goal - profile.tdee, minOffset, 1000);
  }
  return 0;
}

// Calcula calorías meta = TDEE + offset, clamp al mínimo
function getGoalCalories(profile, offset) {
  const base = typeof profile?.tdee === 'number' ? profile.tdee : 0;
  const minKcal = getMinCalories(profile);
  return Math.max(minKcal, Math.round(base + (typeof offset === 'number' ? offset : getGoalOffset(profile))));
}

// Asegura que el perfil tenga goalOffset, goal y customMacros normlizados
function normalizeProfileGoals(profile) {
  const goalOffset = getGoalOffset(profile);
  const goal = getGoalCalories(profile, goalOffset);
  const cm = profile.customMacros || {};
  return {
    ...profile,
    goalOffset,
    goal,
    customMacros: {
      protein: cm.protein != null ? cm.protein : null,
      carbs: cm.carbs != null ? cm.carbs : null,
      fat: cm.fat != null ? cm.fat : null,
      buffer: ['protein','carbs','fat'].includes(cm.buffer) ? cm.buffer : 'carbs'
    }
  };
}

const MACRO_ORDER = ['protein', 'carbs', 'fat'];
const CAL_PER_G = { protein: 4, carbs: 4, fat: 9 };

// Plan completo de macros: offset, calorías, proteína, carbs, grasa
// macroOverrides se usa en setup para pasar valores desde los inputs del DOM
function getGoalPlan(profile, offset, macroOverrides) {
  const actualOffset = typeof offset === 'number' ? offset : getGoalOffset(profile);
  const calories = getGoalCalories(profile, actualOffset);
  const weeklyDeltaKg = actualOffset / 7700 * 7;
  const mode = actualOffset < -25 ? 'Perder peso' : actualOffset > 25 ? 'Ganar peso' : 'Mantener peso';
  const direction = actualOffset < -25 ? 'déficit' : actualOffset > 25 ? 'superávit' : 'mantenimiento';
  const weeklyLabel = weeklyDeltaKg === 0
    ? 'Mantenimiento estimado'
    : `${weeklyDeltaKg > 0 ? '+' : ''}${weeklyDeltaKg.toFixed(2)} kg/semana`;

  const custom = macroOverrides || profile.customMacros || {};
  const buffer = ['protein','carbs','fat'].includes(custom.buffer) ? custom.buffer : 'carbs';
  const weight = Number(profile.weight) || 0;
  const proteinPerKg = actualOffset < -150 ? 2.0 : actualOffset > 150 ? 1.8 : 1.6;
  const fatPerKg = actualOffset < -150 ? 0.8 : 0.9;

  const proteinDefault = Math.round(weight * proteinPerKg);
  const fatDefault = Math.round(weight * fatPerKg);
  const carbsDefault = Math.max(0, Math.round((calories - proteinDefault * 4 - fatDefault * 9) / 4));

  let protein = custom.protein != null ? Math.round(Number(custom.protein)) : proteinDefault;
  let carbs = custom.carbs != null ? Math.round(Number(custom.carbs)) : carbsDefault;
  let fat = custom.fat != null ? Math.round(Number(custom.fat)) : fatDefault;

  if (buffer === 'protein') {
    protein = Math.max(0, Math.round((calories - carbs * 4 - fat * 9) / 4));
  } else if (buffer === 'carbs') {
    carbs = Math.max(0, Math.round((calories - protein * 4 - fat * 9) / 4));
  } else {
    fat = Math.max(0, Math.round((calories - protein * 4 - carbs * 4) / 9));
  }

  return {
    offset: actualOffset,
    calories,
    mode,
    direction,
    weeklyDeltaKg,
    weeklyLabel,
    protein,
    fat,
    carbs,
  };
}

function getGoalText(offset) {
  if (offset < -25) return 'Perder peso';
  if (offset > 25) return 'Ganar peso';
  return 'Mantener peso';
}

function computePct(grams, macro, calories) {
  if (!calories) return 0;
  return Math.round(grams * CAL_PER_G[macro] / calories * 100);
}

function updatePctInputs(prefix, calories, protein, carbs, fat) {
  ['protein','carbs','fat'].forEach(m => {
    const el = document.getElementById(`${prefix}-pct-${m}`);
    if (el) {
      const g = m === 'protein' ? protein : m === 'carbs' ? carbs : fat;
      el.value = computePct(g, m, calories);
    }
  });
}

// Renderiza las tarjetas editables de macros (proteína/carbs/grasa + %)
function renderMacroRecs(containerId, plan, weightReady, buffer) {
  const el = document.getElementById(containerId);
  if (!el) return;

  if (!weightReady) {
    el.innerHTML = '<p class="macro-recs-empty">Completá peso, altura y actividad para ver la recomendación diaria.</p>';
    return;
  }

  const prefix = containerId.replace('-macro-recs', '');
  const b = buffer || 'carbs';
  const sumKcal = plan.protein * 4 + plan.carbs * 4 + plan.fat * 9;
  const diff = sumKcal - plan.calories;
  let diffClass = 'macro-sum-ok', diffText = '✓ Justo a la meta';
  if (Math.abs(diff) > 5) {
    diffClass = diff < 0 ? 'macro-sum-low' : 'macro-sum-high';
    diffText = diff < 0 ? `Faltan ${Math.abs(diff)} kcal` : `Exceden ${diff} kcal`;
  }

  const pctP = computePct(plan.protein, 'protein', plan.calories);
  const pctC = computePct(plan.carbs, 'carbs', plan.calories);
  const pctF = computePct(plan.fat, 'fat', plan.calories);

  const macroCard = (id, label, gramVal, pctVal) => `
    <div class="macro-rec" data-macro="${id}">
      <div class="macro-rec-label">${label}</div>
      <input type="number" class="macro-rec-input" id="${prefix}-macro-${id}" value="${gramVal}" min="0" step="1" oninput="onMacroInput('${prefix}','${id}')" />
      <div class="macro-rec-sub">
        <input type="number" class="macro-pct-input" id="${prefix}-pct-${id}" value="${pctVal}" min="0" max="100" step="1" oninput="onMacroInput('${prefix}','pct-${id}')" />
        <span>%</span>
      </div>
    </div>`;

  const bufferPill = (m, label) =>
    `<button class="macro-buffer-pill ${b === m ? 'active' : ''}" data-buffer="${m}" onclick="setMacroBuffer('${prefix}','${m}')">${label}</button>`;

  el.innerHTML = `
    ${macroCard('protein', 'Proteína', plan.protein, pctP)}
    ${macroCard('carbs', 'Carbohidratos', plan.carbs, pctC)}
    ${macroCard('fat', 'Grasas', plan.fat, pctF)}
    <div class="macro-sum-indicator" id="${prefix}-macro-sum">
      <span class="macro-sum-text">${sumKcal} / ${plan.calories} kcal</span>
      <span class="macro-sum-diff ${diffClass}">${diffText}</span>
    </div>
    <div class="macro-buffer-toggle" id="${prefix}-macro-buffer">
      <span class="macro-buffer-label">Redondear:</span>
      ${bufferPill('protein', 'Proteína')}
      ${bufferPill('carbs', 'Carbohidratos')}
      ${bufferPill('fat', 'Grasas')}
    </div>
  `;
}

function getMacroBuffer(prefix) {
  const toggle = document.getElementById(`${prefix}-macro-buffer`);
  if (toggle) {
    const active = toggle.querySelector('.macro-buffer-pill.active');
    if (active) return active.dataset.buffer;
  }
  return 'carbs';
}

function setMacroBuffer(prefix, buffer) {
  document.querySelectorAll(`#${prefix}-macro-buffer .macro-buffer-pill`).forEach(btn => {
    btn.classList.toggle('active', btn.dataset.buffer === buffer);
  });
  if (prefix !== 'setup' && currentProfile) {
    const profiles = getProfiles();
    if (!profiles[currentProfile.id].customMacros) profiles[currentProfile.id].customMacros = {};
    profiles[currentProfile.id].customMacros.buffer = buffer;
    currentProfile = profiles[currentProfile.id];
    saveProfiles(profiles);
  }
  onMacroInput(prefix, null);
}

function onMacroInput(prefix, macro) {
  const isPct = typeof macro === 'string' && macro.startsWith('pct-');
  const changedMacro = isPct ? macro.slice(4) : macro;

  let protein = parseInt(document.getElementById(`${prefix}-macro-protein`).value) || 0;
  let carbs = parseInt(document.getElementById(`${prefix}-macro-carbs`).value) || 0;
  let fat = parseInt(document.getElementById(`${prefix}-macro-fat`).value) || 0;
  const kcalInput = document.getElementById(`${prefix}-goal-kcal-input`);
  const calories = parseInt(kcalInput?.value) || 0;

  if (isPct && calories > 0) {
    const el = document.getElementById(`${prefix}-pct-${changedMacro}`);
    let pct = Math.max(0, Math.min(100, parseFloat(el.value) || 0));
    const newGrams = Math.round(calories * pct / 100 / CAL_PER_G[changedMacro]);
    document.getElementById(`${prefix}-macro-${changedMacro}`).value = newGrams;
    if (changedMacro === 'protein') protein = newGrams;
    else if (changedMacro === 'carbs') carbs = newGrams;
    else fat = newGrams;
  }

  let buffer = getMacroBuffer(prefix);

  if (changedMacro && changedMacro === buffer) {
    const idx = MACRO_ORDER.indexOf(buffer);
    buffer = MACRO_ORDER[(idx + 1) % MACRO_ORDER.length];
    document.querySelectorAll(`#${prefix}-macro-buffer .macro-buffer-pill`).forEach(btn => {
      btn.classList.toggle('active', btn.dataset.buffer === buffer);
    });
  }

  if (buffer === 'carbs') {
    carbs = Math.max(0, Math.round((calories - protein * 4 - fat * 9) / 4));
  } else if (buffer === 'protein') {
    protein = Math.max(0, Math.round((calories - carbs * 4 - fat * 9) / 4));
  } else {
    fat = Math.max(0, Math.round((calories - protein * 4 - carbs * 4) / 9));
  }

  const activeEl = document.activeElement;
  const bufferInput = document.getElementById(`${prefix}-macro-${buffer}`);
  if (bufferInput && bufferInput !== activeEl) {
    bufferInput.value = buffer === 'protein' ? protein : buffer === 'carbs' ? carbs : fat;
  }

  updatePctInputs(prefix, calories, protein, carbs, fat);

  if (prefix !== 'setup' && currentProfile) {
    const profiles = getProfiles();
    if (!profiles[currentProfile.id].customMacros) profiles[currentProfile.id].customMacros = {};
    profiles[currentProfile.id].customMacros.protein = protein;
    profiles[currentProfile.id].customMacros.carbs = carbs;
    profiles[currentProfile.id].customMacros.fat = fat;
    profiles[currentProfile.id].customMacros.buffer = buffer;
    currentProfile = profiles[currentProfile.id];
    saveProfiles(profiles);
    renderHome();
  }

  const sumKcal = protein * 4 + carbs * 4 + fat * 9;
  const sumEl = document.getElementById(`${prefix}-macro-sum`);
  if (sumEl) {
    const diff = sumKcal - calories;
    let diffClass = 'macro-sum-ok', diffText = '✓ Justo a la meta';
    if (Math.abs(diff) > 5) {
      diffClass = diff < 0 ? 'macro-sum-low' : 'macro-sum-high';
      diffText = diff < 0 ? `Faltan ${Math.abs(diff)} kcal` : `Exceden ${diff} kcal`;
    }
    sumEl.innerHTML = `
      <span class="macro-sum-text">${sumKcal} / ${calories} kcal</span>
      <span class="macro-sum-diff ${diffClass}">${diffText}</span>
    `;
  }
}

// Actualiza la preview del goal (slider + kcal input + macros) en setup o settings
function updateGoalPreview(prefix, profileLike, offsetOverride) {
  const isSetup = prefix === 'setup';
  const base = profileLike || (isSetup ? {
    weight: parseFloat(document.getElementById('setup-weight').value),
    height: parseFloat(document.getElementById('setup-height').value),
    age: parseInt(document.getElementById('setup-age').value),
    sex: document.getElementById('setup-sex').value,
    activity: document.getElementById('setup-activity').value,
  } : currentProfile);

  const weightReady = !!(base && base.weight && base.height && base.age && base.sex && base.activity);
  const tdee = weightReady ? calcTDEE(base) : (base.tdee || 0);
  const minKcal = getMinCalories(base);
  const minOffset = weightReady ? Math.max(-1000, Math.round(minKcal - tdee)) : -1000;

  const slider = document.getElementById(`${prefix}-goal-offset`);
  if (slider) {
    slider.min = minOffset;
  }

  const offsetInput = offsetOverride !== undefined
    ? offsetOverride
    : parseInt(document.getElementById(`${prefix}-goal-offset`).value || '0', 10);
  const offset = clamp(Number.isNaN(offsetInput) ? 0 : offsetInput, minOffset, 1000);

  // En setup, leer valores actuales de los inputs de macros (si existen) como overrides
  let macroOverrides = null;
  if (isSetup) {
    const pEl = document.getElementById('setup-macro-protein');
    const cEl = document.getElementById('setup-macro-carbs');
    const fEl = document.getElementById('setup-macro-fat');
    if (pEl && cEl && fEl) {
      macroOverrides = {
        protein: parseInt(pEl.value) || null,
        carbs: parseInt(cEl.value) || null,
        fat: parseInt(fEl.value) || null,
        buffer: getMacroBuffer('setup'),
      };
    } else {
      // Fallback a customMacros guardados del perfil (si inputs aún no existen)
      const activeProfiles = getProfiles();
      const activeId = getActiveProfileId();
      if (activeId && activeProfiles[activeId]?.customMacros) {
        macroOverrides = activeProfiles[activeId].customMacros;
      }
    }
  }
  const plan = getGoalPlan({ ...base, tdee }, offset, macroOverrides);

  const modeEl = document.getElementById(`${prefix}-goal-mode`);
  const kcalInput = document.getElementById(`${prefix}-goal-kcal-input`);
  const changeEl = document.getElementById(`${prefix}-goal-change`);

  if (modeEl) modeEl.textContent = weightReady ? plan.mode : 'Completá tus datos para ver tu meta';
  if (kcalInput) {
    if (weightReady) {
      kcalInput.disabled = false;
      kcalInput.min = minKcal;
      if (document.activeElement !== kcalInput) {
        kcalInput.value = plan.calories;
      }
    } else {
      kcalInput.value = '';
      kcalInput.disabled = true;
    }
  }
  if (changeEl) changeEl.textContent = weightReady ? `${plan.offset > 0 ? '+' : ''}${plan.offset} kcal/día · ${plan.weeklyLabel}` : 'Ajuste de 0 kcal/día';

  const buffer = macroOverrides?.buffer || (profileLike?.customMacros?.buffer) || 'carbs';
  renderMacroRecs(`${prefix}-macro-recs`, plan, weightReady, buffer);
}

// Sincroniza slider → profile → render en settings
function syncGoalFromSlider(prefix) {
  if (prefix === 'setup') {
    updateGoalPreview('setup');
    return;
  }

  if (!currentProfile) return;
  const slider = document.getElementById('settings-goal-offset');
  const minKcal = getMinCalories(currentProfile);
  const minOffset = Math.round(minKcal - currentProfile.tdee);
  const offset = clamp(parseInt(slider.value || '0', 10) || 0, minOffset, 1000);
  currentProfile.goalOffset = offset;
  currentProfile.goal = getGoalCalories(currentProfile, offset);

  const profiles = getProfiles();
  profiles[currentProfile.id] = currentProfile;
  saveProfiles(profiles);
  renderSidebar();
  renderHome();
  renderSettings();
}

// Wrappers de eventos para HTML onclick
function updateSetupGoalPreview() { updateGoalPreview('setup'); }
function updateSettingsGoalPreview() { syncGoalFromSlider('settings'); }

// Maneja input directo de kcal en el goal
function onGoalKcalInput(prefix) {
  const isSetup = prefix === 'setup';
  const base = isSetup ? {
    weight: parseFloat(document.getElementById('setup-weight').value),
    height: parseFloat(document.getElementById('setup-height').value),
    age: parseInt(document.getElementById('setup-age').value),
    sex: document.getElementById('setup-sex').value,
    activity: document.getElementById('setup-activity').value,
  } : currentProfile;

  const weightReady = !!(base && base.weight && base.height && base.age && base.sex && base.activity);
  if (!weightReady) return;

  const tdee = calcTDEE(base);
  const minKcal = getMinCalories(base);
  const kcalInput = document.getElementById(`${prefix}-goal-kcal-input`);
  const kcal = parseInt(kcalInput.value, 10);
  if (Number.isNaN(kcal) || kcal < 500) return;

  const minOffset = Math.round(minKcal - tdee);
  const offset = clamp(kcal - tdee, minOffset, 1000);
  const slider = document.getElementById(`${prefix}-goal-offset`);
  if (slider) slider.value = offset;

  if (isSetup) {
    updateGoalPreview('setup', null, offset);
  } else {
    if (!currentProfile) return;
    currentProfile.goalOffset = offset;
    currentProfile.goal = getGoalCalories(currentProfile, offset);

    const profiles = getProfiles();
    profiles[currentProfile.id] = currentProfile;
    saveProfiles(profiles);

    updateGoalPreview('settings', currentProfile, offset);
    renderSidebar();
    renderHome();
  }
}

function restoreGoalKcal(prefix) {
  updateGoalPreview(prefix);
}
