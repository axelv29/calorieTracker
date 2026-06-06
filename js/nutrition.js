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

// Asegura que el perfil tenga goalOffset y goal normalizados
function normalizeProfileGoals(profile) {
  const goalOffset = getGoalOffset(profile);
  const goal = getGoalCalories(profile, goalOffset);
  return { ...profile, goalOffset, goal };
}

// Plan completo de macros: offset, calorías, proteína, carbs, grasa
function getGoalPlan(profile, offset) {
  const actualOffset = typeof offset === 'number' ? offset : getGoalOffset(profile);
  const calories = getGoalCalories(profile, actualOffset);
  const weeklyDeltaKg = actualOffset / 7700 * 7;
  const mode = actualOffset < -25 ? 'Perder peso' : actualOffset > 25 ? 'Ganar peso' : 'Mantener peso';
  const direction = actualOffset < -25 ? 'déficit' : actualOffset > 25 ? 'superávit' : 'mantenimiento';
  const proteinPerKg = actualOffset < -150 ? 2.0 : actualOffset > 150 ? 1.8 : 1.6;
  const fatPerKg = actualOffset < -150 ? 0.8 : 0.9;
  const weight = Number(profile.weight) || 0;
  const protein = Math.round(weight * proteinPerKg);
  const fat = Math.round(weight * fatPerKg);
  const carbs = Math.max(0, Math.round((calories - protein * 4 - fat * 9) / 4));
  const weeklyLabel = weeklyDeltaKg === 0
    ? 'Mantenimiento estimado'
    : `${weeklyDeltaKg > 0 ? '+' : ''}${weeklyDeltaKg.toFixed(2)} kg/semana`;

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

// Renderiza las tarjetas de recomendación de macros (proteína/carbs/grasa)
function renderMacroRecs(containerId, plan, weightReady) {
  const el = document.getElementById(containerId);
  if (!el) return;

  if (!weightReady) {
    el.innerHTML = '<p class="macro-recs-empty">Completá peso, altura y actividad para ver la recomendación diaria.</p>';
    return;
  }

  el.innerHTML = `
    <div class="macro-rec">
      <div class="macro-rec-label">Proteína</div>
      <div class="macro-rec-value">${plan.protein}g</div>
      <div class="macro-rec-sub">por día</div>
    </div>
    <div class="macro-rec">
      <div class="macro-rec-label">Carbohidratos</div>
      <div class="macro-rec-value">${plan.carbs}g</div>
      <div class="macro-rec-sub">por día</div>
    </div>
    <div class="macro-rec">
      <div class="macro-rec-label">Grasas</div>
      <div class="macro-rec-value">${plan.fat}g</div>
      <div class="macro-rec-sub">por día</div>
    </div>
  `;
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
  const plan = getGoalPlan({ ...base, tdee }, offset);

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
  renderMacroRecs(`${prefix}-macro-recs`, plan, weightReady);
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
