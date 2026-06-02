// ===== STATE =====
let currentProfile = null;
let currentDate = todayStr();
let photoBase64 = null;
let aiParsedFood = null;
let editingFoodId = null;
let selectedMealType = 'breakfast';

function todayStr() {
  return new Date().toISOString().split('T')[0];
}

function getStorage(key) {
  try { return JSON.parse(localStorage.getItem(key)); } catch { return null; }
}

function setStorage(key, val) {
  localStorage.setItem(key, JSON.stringify(val));
}

const MEAL_LABELS = {
  breakfast: 'Desayuno',
  lunch: 'Almuerzo',
  snack: 'Merienda',
  dinner: 'Cena',
  other: 'Otros'
};
const MEAL_ORDER = ['breakfast', 'lunch', 'snack', 'dinner', 'other'];

function mealTypeLabel(type) {
  return MEAL_LABELS[type] || 'Otros';
}

function getMealGroups(foods) {
  const groups = MEAL_ORDER.map(type => ({
    type,
    label: mealTypeLabel(type),
    foods: []
  }));

  foods.forEach(food => {
    const type = MEAL_ORDER.includes(food.mealType) ? food.mealType : 'other';
    const group = groups.find(g => g.type === type);
    if (group) group.foods.push(food);
  });

  return groups.filter(group => group.foods.length > 0);
}

// ===== PROFILES =====
function getProfiles() { return getStorage('nutre_profiles') || {}; }
function saveProfiles(p) { setStorage('nutre_profiles', p); }
function getActiveProfileId() { return localStorage.getItem('nutre_active_profile'); }
function setActiveProfileId(id) { localStorage.setItem('nutre_active_profile', id); }

function calcTDEE(profile) {
  const { weight, height, age, sex, activity } = profile;
  let bmr;
  if (sex === 'm') bmr = 10 * weight + 6.25 * height - 5 * age + 5;
  else bmr = 10 * weight + 6.25 * height - 5 * age - 161;
  return Math.round(bmr * parseFloat(activity));
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function parseAiJson(text) {
  const clean = String(text || '').replace(/```json|```/g, '').trim();
  return JSON.parse(clean);
}

function normalizeAiFood(food, fallbackWeight) {
  const normalized = {
    name: String(food?.name || '').trim(),
    kcal: Math.round(Number(food?.kcal) || 0),
    protein: Number(food?.protein) || 0,
    carbs: Number(food?.carbs) || 0,
    fat: Number(food?.fat) || 0,
    weight: food?.weight ?? null,
    note: String(food?.note || '').trim(),
    ingredients: Array.isArray(food?.ingredients) ? food.ingredients : [],
  };

  if (fallbackWeight && !normalized.weight) normalized.weight = parseInt(fallbackWeight, 10);
  return normalized;
}

function startAiAnalysis(buttonId, message) {
  const loading = document.getElementById('loading-state');
  const loadingMessage = document.getElementById('loading-message');
  const result = document.getElementById('ai-result');
  const saveToggle = document.getElementById('save-toggle');
  const addBtn = document.getElementById('add-food-btn');
  const btn = document.getElementById(buttonId);

  if (loadingMessage) loadingMessage.textContent = message || 'Analizando tu plato con IA…';
  if (loading) loading.style.display = 'block';
  if (result) result.style.display = 'none';
  if (saveToggle) saveToggle.style.display = 'none';
  if (addBtn) addBtn.style.display = 'none';
  if (btn) btn.disabled = true;
}

function finishAiAnalysis(buttonId) {
  const loading = document.getElementById('loading-state');
  const btn = document.getElementById(buttonId);
  if (loading) loading.style.display = 'none';
  if (btn) btn.disabled = false;
}

function toggleTextAnalyzeButton() {
  const input = document.getElementById('text-input');
  const btn = document.getElementById('analyze-text-btn');
  if (btn && input) btn.disabled = !input.value.trim();
}

function showAiFoodResult(food, fallbackWeight) {
  aiParsedFood = normalizeAiFood(food, fallbackWeight);

  document.getElementById('edit-name').value = aiParsedFood.name;
  document.getElementById('edit-kcal').value = aiParsedFood.kcal;
  document.getElementById('edit-protein').value = Math.round(aiParsedFood.protein);
  document.getElementById('edit-carbs').value = Math.round(aiParsedFood.carbs);
  document.getElementById('edit-fat').value = Math.round(aiParsedFood.fat);
  document.getElementById('res-note').textContent = aiParsedFood.note || 'Podés ajustar los valores antes de guardar.';
  renderIngredients(aiParsedFood.ingredients);

  document.getElementById('ai-result').style.display = 'block';
  document.getElementById('save-toggle').style.display = 'flex';
  document.getElementById('add-food-btn').style.display = 'block';
}

function buildPhotoPrompt(weight, context) {
  const weightText = weight ? ` La porción pesa ${weight} gramos.` : '';
  const contextText = context ? ` Contexto adicional del usuario: "${context}".` : '';
  return `Actuá como un nutricionista profesional y analizá esta foto de comida en detalle.

Estimá cada ingrediente visible del plato de forma individual, considerando:
- El plato tiene un diámetro estándar de aproximadamente 25 cm (usá esto como referencia para estimar tamaños y cantidades).
- La cocina es uruguaya / rioplatense (tené en cuenta platos típicos como milanesas, pastas, chivito, asado, guisos, etc.).
- Calculá calorías y macronutrientes (proteína, carbohidratos, grasas) con la mayor precisión posible.
- Agrupá ingredientes en componentes lógicos sin sobredetallar: por ejemplo, "milanesa de pollo" (no desglosar en carne, huevo, pan rallado), "arroz blanco", "puré de papas", etc.
- Si hay duda entre dos estimaciones, elegí la más probable para un plato casero uruguayo.

${weightText}${contextText}

Respondé SOLO con un JSON válido, sin markdown ni texto extra, con este formato exacto:
{
  "name": "nombre descriptivo del plato completo",
  "kcal": número total,
  "protein": número total en gramos,
  "carbs": número total en gramos,
  "fat": número total en gramos,
  "weight": número en gramos o null,
  "note": "breve nota sobre la estimación",
  "ingredients": [
    { "name": "primer componente", "kcal": número, "protein": gramos, "carbs": gramos, "fat": gramos },
    { "name": "segundo componente", "kcal": número, "protein": gramos, "carbs": gramos, "fat": gramos }
  ]
}`;
}

function buildTextPrompt(description) {
  return `Actuá como un nutricionista profesional y estimá la comida descrita por el usuario.

El usuario NO mandó foto, solo texto. Interpretá porciones razonables a partir de la descripción. Si el texto es algo simple como "manzana grande", "banana mediana" o "yogur con granola", asumí una porción estándar normal. Si el usuario menciona tamaño, cantidad, preparación o contexto, usalo para ajustar la estimación. Si algo es ambiguo, elegí la versión más probable en un contexto uruguayo / rioplatense.

Descripción del usuario: "${description}"

Respondé SOLO con un JSON válido, sin markdown ni texto extra, con este formato exacto:
{
  "name": "nombre descriptivo del alimento o plato",
  "kcal": número total,
  "protein": número total en gramos,
  "carbs": número total en gramos,
  "fat": número total en gramos,
  "weight": número en gramos o null,
  "note": "breve nota sobre la estimación",
  "ingredients": [
    { "name": "componente principal", "kcal": número, "protein": gramos, "carbs": gramos, "fat": gramos }
  ]
}`;
}

function getMinCalories(profile) {
  const weight = Number(profile?.weight) || 0;
  if (weight <= 0) return 1200;
  const minProtein = Math.round(weight * 2.0);
  const minFat = Math.round(weight * 0.8);
  return Math.max(1200, minProtein * 4 + minFat * 9);
}

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

function getGoalCalories(profile, offset) {
  const base = typeof profile?.tdee === 'number' ? profile.tdee : 0;
  const minKcal = getMinCalories(profile);
  return Math.max(minKcal, Math.round(base + (typeof offset === 'number' ? offset : getGoalOffset(profile))));
}

function normalizeProfileGoals(profile) {
  const goalOffset = getGoalOffset(profile);
  const goal = getGoalCalories(profile, goalOffset);
  return { ...profile, goalOffset, goal };
}

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

  // Dynamically update slider min value to prevent phantom range
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

function updateSetupGoalPreview() {
  updateGoalPreview('setup');
}

function updateSettingsGoalPreview() {
  syncGoalFromSlider('settings');
}

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

function saveProfile() {
  const name = document.getElementById('setup-name').value.trim();
  const age = parseInt(document.getElementById('setup-age').value);
  const sex = document.getElementById('setup-sex').value;
  const weight = parseFloat(document.getElementById('setup-weight').value);
  const height = parseFloat(document.getElementById('setup-height').value);
  const activity = document.getElementById('setup-activity').value;
  const apiKey = document.getElementById('setup-apikey').value.trim();

  if (!name || !age || !weight || !height) {
    showToast('Completá nombre, edad, peso y altura');
    return;
  }

  const tdee = calcTDEE({ weight, height, age, sex, activity });
  const minKcal = getMinCalories({ weight });
  const customKcal = parseInt(document.getElementById('setup-goal-kcal-input').value, 10);
  const minOffset = Math.round(minKcal - tdee);
  const goalOffset = !Number.isNaN(customKcal)
    ? clamp(customKcal - tdee, minOffset, 1000)
    : clamp(parseInt(document.getElementById('setup-goal-offset').value || '0', 10) || 0, minOffset, 1000);
  const goal = getGoalCalories({ tdee, weight }, goalOffset);

  const profiles = getProfiles();
  const existingId = getActiveProfileId();
  const id = (existingId && profiles[existingId] && profiles[existingId].name === name)
    ? existingId
    : 'profile_' + Date.now();

  profiles[id] = {
    id, name, age, sex, weight, height, activity,
    tdee,
    goalOffset,
    goal,
    apiKey: apiKey || (profiles[id] ? profiles[id].apiKey : ''),
    savedFoods: profiles[id] ? profiles[id].savedFoods : []
  };

  saveProfiles(profiles);
  setActiveProfileId(id);
  loadApp();
}

function loadApp() {
  const profiles = getProfiles();
  const id = getActiveProfileId();
  if (!id || !profiles[id]) { showSetup(); return; }

  currentProfile = normalizeProfileGoals(profiles[id]);
  profiles[id] = currentProfile;
  saveProfiles(profiles);
  document.getElementById('setup-screen').style.display = 'none';
  document.getElementById('app').style.display = '';
  document.getElementById('bottom-nav').style.display = 'flex';
  document.getElementById('fab').style.display = 'flex';

  currentDate = todayStr();
  renderSidebar();
  showPage('home');
}

function showSetup(prefillId) {
  document.getElementById('setup-screen').style.display = 'flex';
  document.getElementById('app').style.display = 'none';
  document.getElementById('bottom-nav').style.display = 'none';
  document.getElementById('fab').style.display = 'none';

  const profiles = getProfiles();
  renderProfileSwitcher(profiles, prefillId);
  if (prefillId && profiles[prefillId]) prefillSetupForm(profiles[prefillId]);
  else clearSetupForm();
  updateGoalPreview('setup');
}

function renderProfileSwitcher(profiles, activeId) {
  const container = document.getElementById('profiles-switcher');
  const keys = Object.keys(profiles);
  if (keys.length === 0) { container.innerHTML = ''; return; }
  container.innerHTML = keys.map(id =>
    `<button class="profile-chip ${id === activeId ? 'active' : ''}" onclick="selectSetupProfile('${id}')">${profiles[id].name}</button>`
  ).join('') + `<button class="profile-chip add-profile" onclick="clearSetupForm()"><i class="ph ph-plus" aria-hidden="true" style="font-size:10px;margin-right:4px;vertical-align:middle;"></i>Nuevo</button>`;
}

function selectSetupProfile(id) {
  setActiveProfileId(id);
  showSetup(id);
}

function prefillSetupForm(p) {
  document.getElementById('setup-name').value = p.name;
  document.getElementById('setup-age').value = p.age;
  document.getElementById('setup-sex').value = p.sex;
  document.getElementById('setup-weight').value = p.weight;
  document.getElementById('setup-height').value = p.height;
  document.getElementById('setup-activity').value = p.activity;
  document.getElementById('setup-goal-offset').value = getGoalOffset(p);
  document.getElementById('setup-apikey').value = p.apiKey || '';
}

function clearSetupForm() {
  ['setup-name','setup-age','setup-weight','setup-height','setup-apikey'].forEach(id => {
    document.getElementById(id).value = '';
  });
  document.getElementById('setup-sex').value = 'm';
  document.getElementById('setup-activity').value = '1.55';
  document.getElementById('setup-goal-offset').value = 0;
  const profiles = getProfiles();
  renderProfileSwitcher(profiles, null);
}

// ===== SIDEBAR =====
function renderSidebar() {
  const p = currentProfile;
  const el = document.getElementById('sidebar-profile-name');
  const sub = document.getElementById('sidebar-profile-sub');
  const av = document.getElementById('sidebar-avatar');
  if (el) el.textContent = p.name;
  if (sub) sub.textContent = getGoalText(getGoalOffset(p)) + ' · ' + p.goal + ' kcal/día';
  if (av) av.textContent = p.name.charAt(0).toUpperCase();
}

// ===== FOOD DATA =====
function getFoodsKey(profileId, date) { return `nutre_foods_${profileId}_${date}`; }
function getFoods(date) { return getStorage(getFoodsKey(currentProfile.id, date)) || []; }
function saveFoods(date, foods) { setStorage(getFoodsKey(currentProfile.id, date), foods); }

function addFood(food) {
  let foods = getFoods(currentDate);
  if (editingFoodId) {
    const idx = foods.findIndex(f => f.id === editingFoodId);
    if (idx !== -1) {
      foods[idx] = { ...food, id: editingFoodId, mealType: selectedMealType };
    }
    editingFoodId = null;
  } else {
    foods.push({ ...food, id: Date.now(), mealType: selectedMealType });
  }
  saveFoods(currentDate, foods);
  renderHome();
}

function deleteFood(id) {
  const foods = getFoods(currentDate).filter(f => f.id !== id);
  saveFoods(currentDate, foods);
  renderHome();
}

function editFood(id) {
  const foods = getFoods(currentDate);
  const food = foods.find(f => f.id === id);
  if (!food) return;
  editingFoodId = id;
  selectedMealType = food.mealType || 'breakfast';
  openModal('edit', food);
}

// ===== MEAL TYPE =====
function selectMealType(type) {
  selectedMealType = type;
  document.querySelectorAll('.meal-pill').forEach(b => {
    b.classList.toggle('active', b.dataset.meal === type);
  });
}

// ===== RENDER HOME =====
function renderHome() {
  const foods = getFoods(currentDate);
  const totalKcal = foods.reduce((s, f) => s + (f.kcal || 0), 0);
  const totalProtein = foods.reduce((s, f) => s + (f.protein || 0), 0);
  const totalCarbs = foods.reduce((s, f) => s + (f.carbs || 0), 0);
  const totalFat = foods.reduce((s, f) => s + (f.fat || 0), 0);
  const goalPlan = getGoalPlan(currentProfile, getGoalOffset(currentProfile));
  const goal = currentProfile.goal;
  const remaining = goal - totalKcal;
  const balance = totalKcal - goal;

  // Ring
  const pct = Math.min(totalKcal / goal, 1);
  const R = 40, C = 2 * Math.PI * R;
  const ring = document.getElementById('ring-progress');
  if (ring) {
    ring.style.strokeDashoffset = C - pct * C;
    ring.style.stroke = totalKcal > goal ? 'var(--orange)' : 'var(--primary)';
  }
  const kcalEl = document.getElementById('ring-kcal');
  if (kcalEl) kcalEl.textContent = totalKcal;

  // Stats
  setText('stat-goal', goal + ' kcal');
  const remEl = document.getElementById('stat-remaining');
  if (remEl) {
    remEl.textContent = Math.abs(remaining) + ' kcal';
    remEl.className = 'ring-stat-val ' + (remaining >= 0 ? 'color-green' : 'color-orange');
  }
  const balEl = document.getElementById('stat-balance');
  if (balEl) {
    balEl.textContent = (balance > 0 ? '+' : '') + balance + ' kcal';
    balEl.className = 'ring-stat-val ' + (balance <= 0 ? 'color-green' : 'color-orange');
  }

  // Macros bars
  const proteinGoal = Math.max(goalPlan.protein, 1);
  const carbsGoal = Math.max(goalPlan.carbs, 1);
  const fatGoal = Math.max(goalPlan.fat, 1);
  setBar('bar-protein', totalProtein / proteinGoal * 100);
  setBar('bar-carbs', totalCarbs / carbsGoal * 100);
  setBar('bar-fat', totalFat / fatGoal * 100);
  setText('val-protein', Math.round(totalProtein) + 'g/' + proteinGoal + 'g');
  setText('val-carbs', Math.round(totalCarbs) + 'g/' + carbsGoal + 'g');
  setText('val-fat', Math.round(totalFat) + 'g/' + fatGoal + 'g');

  // Food list
  const list = document.getElementById('food-list');
  if (!list) return;

  if (foods.length === 0) {
    list.innerHTML = `<div class="empty-state">
      <p>No hay comidas registradas hoy.<br>Tocá <strong>+ Agregar</strong> para empezar.</p>
    </div>`;
  } else {
    const groups = getMealGroups(foods);
    list.innerHTML = groups.map(group => `
      <section class="meal-group">
        <div class="meal-group-head">
          <div class="meal-group-title">${escHtml(group.label)}</div>
          <div class="meal-group-count">${group.foods.length} comida${group.foods.length === 1 ? '' : 's'}</div>
        </div>
        <div class="meal-group-list">
          ${group.foods.map(f => `
            <div class="food-item">
              <div class="food-emoji"></div>
              <div class="food-info">
                <div class="food-name">${escHtml(f.name)}</div>
                <div class="food-meta">
                  ${f.weight ? f.weight + 'g · ' : ''}P: ${Math.round(f.protein||0)}g · C: ${Math.round(f.carbs||0)}g · G: ${Math.round(f.fat||0)}g
                </div>
              </div>
              <span class="food-kcal">${f.kcal} kcal</span>
              <button class="food-edit-btn" onclick="editFood(${f.id})" title="Editar"><i class="ph-fill ph-pencil-simple" aria-hidden="true"></i></button>
              <button class="food-delete" onclick="deleteFood(${f.id})" title="Eliminar"><i class="ph-fill ph-trash" aria-hidden="true"></i></button>
            </div>
          `).join('')}
        </div>
      </section>
    `).join('');
  }

  // Mini week chart in home
  renderMiniWeek();

  // Summary banner
  renderSummaryBanner(totalKcal, goal, balance);
}

function renderSummaryBanner(totalKcal, goal, balance) {
  const el = document.getElementById('summary-banner');
  if (!el) return;
  if (balance <= 0) {
    el.style.background = 'linear-gradient(135deg, var(--primary) 0%, var(--blue) 100%)';
    el.querySelector('.banner-title').textContent = '¡Vas bien hoy!';
    el.querySelector('.banner-sub').textContent = `Todavía podés comer ${Math.abs(balance)} kcal más`;
    el.querySelector('.bval').textContent = Math.abs(balance);
    el.querySelector('.bsub').textContent = 'kcal restantes';
  } else {
    el.style.background = 'linear-gradient(135deg, var(--orange) 0%, var(--red) 100%)';
    el.querySelector('.banner-title').textContent = 'Pasaste la meta';
    el.querySelector('.banner-sub').textContent = 'Superaste tu objetivo calórico';
    el.querySelector('.bval').textContent = '+' + balance;
    el.querySelector('.bsub').textContent = 'kcal sobre la meta';
  }
}

function renderMiniWeek() {
  const el = document.getElementById('mini-week-bars');
  if (!el) return;
  const today = new Date(todayStr() + 'T12:00:00');
  const dayLabels = ['D','L','M','X','J','V','S'];
  const weekData = [];
  let maxKcal = 1;

  for (let i = 6; i >= 0; i--) {
    const d = new Date(today); d.setDate(d.getDate() - i);
    const ds = d.toISOString().split('T')[0];
    const foods = getStorage(getFoodsKey(currentProfile.id, ds)) || [];
    const kcal = foods.reduce((s, f) => s + (f.kcal || 0), 0);
    if (kcal > maxKcal) maxKcal = kcal;
    weekData.push({ ds, kcal, label: dayLabels[d.getDay()], isToday: ds === todayStr() });
  }

  el.innerHTML = weekData.map(({ kcal, label, isToday }) => {
    const pct = kcal > 0 ? Math.max(8, (kcal / Math.max(maxKcal, currentProfile.goal)) * 72) : 4;
    let cls = 'empty';
    if (kcal > 0) cls = isToday ? 'today' : kcal > currentProfile.goal ? 'over' : 'under';
    return `<div class="week-bar-col">
      <div class="week-bar ${cls}" style="height:${pct}px"></div>
      <span class="week-day-label">${label}</span>
    </div>`;
  }).join('');

  // Week avg
  const withKcal = weekData.filter(d => d.kcal > 0);
  const avg = withKcal.length > 0 ? Math.round(withKcal.reduce((s, d) => s + d.kcal, 0) / withKcal.length) : 0;
  const avgEl = document.getElementById('week-avg');
  if (avgEl) avgEl.textContent = avg > 0 ? avg + ' kcal/día promedio esta semana' : 'Sin datos esta semana';
}

// ===== HEADER DATE =====
function updateHeaderDate() {
  const today = todayStr();
  const d = new Date(currentDate + 'T12:00:00');
  const months = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
  const days = ['domingo','lunes','martes','miércoles','jueves','viernes','sábado'];

  let label;
  if (currentDate === today) label = 'Hoy';
  else {
    const diff = Math.round((new Date(today + 'T12:00:00') - d) / 86400000);
    label = diff === 1 ? 'Ayer' : days[d.getDay()] + ' ' + d.getDate();
  }

  setText('header-day', label);
  setText('header-date', d.getDate() + ' de ' + months[d.getMonth()]);
}

function goToDate(delta) {
  const d = new Date(currentDate + 'T12:00:00');
  d.setDate(d.getDate() + delta);
  if (d > new Date()) return;
  currentDate = d.toISOString().split('T')[0];
  updateHeaderDate();
  renderHome();
}

function goToToday() {
  currentDate = todayStr();
  updateHeaderDate();
  renderHome();
}

// ===== STATS =====
function renderStats() {
  const today = new Date(todayStr() + 'T12:00:00');
  const dayLabels = ['D','L','M','X','J','V','S'];

  // Big week chart
  const barsEl = document.getElementById('big-week-bars');
  let weekTotal = 0, weekDays = 0, maxKcal = 1;
  const weekData = [];

  for (let i = 6; i >= 0; i--) {
    const d = new Date(today); d.setDate(d.getDate() - i);
    const ds = d.toISOString().split('T')[0];
    const foods = getStorage(getFoodsKey(currentProfile.id, ds)) || [];
    const kcal = foods.reduce((s, f) => s + (f.kcal || 0), 0);
    if (kcal > 0) { weekTotal += kcal; weekDays++; }
    if (kcal > maxKcal) maxKcal = kcal;
    weekData.push({ ds, kcal, label: dayLabels[d.getDay()], isToday: ds === todayStr() });
  }

  if (barsEl) {
    const goal = currentProfile.goal;
    barsEl.innerHTML = weekData.map(({ kcal, label, isToday }) => {
      const pct = kcal > 0 ? Math.max(8, (kcal / Math.max(maxKcal, goal)) * 108) : 4;
      let cls = kcal === 0 ? 'empty' : isToday ? 'today' : kcal > goal ? 'over' : 'under';
      return `<div class="big-bar-col">
        <span class="big-bar-val">${kcal > 0 ? kcal : ''}</span>
        <div class="big-bar ${cls}" style="height:${pct}px" title="${kcal} kcal"></div>
        <span class="big-bar-label">${label}</span>
      </div>`;
    }).join('');
  }

  // Monthly stats
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
  let monthTotal = 0, monthDays = 0, totalDeficit = 0;
  const daysInMonth = today.getDate();

  for (let i = 0; i < daysInMonth; i++) {
    const d = new Date(monthStart); d.setDate(d.getDate() + i);
    const ds = d.toISOString().split('T')[0];
    const foods = getStorage(getFoodsKey(currentProfile.id, ds)) || [];
    const kcal = foods.reduce((s, f) => s + (f.kcal || 0), 0);
    if (kcal > 0) { monthTotal += kcal; monthDays++; }
    totalDeficit += currentProfile.goal - kcal;
  }

  const weekAvg = weekDays > 0 ? Math.round(weekTotal / weekDays) : 0;
  const monthAvg = monthDays > 0 ? Math.round(monthTotal / monthDays) : 0;
  const gramsFat = Math.round(Math.abs(totalDeficit) / 7700 * 1000);

  const grid = document.getElementById('stats-grid');
  if (!grid) return;

  const defSign = totalDeficit >= 0;
  grid.innerHTML = `
    <div class="stat-card">
      <div class="sc-label">Promedio semanal</div>
      <div class="sc-value ${weekAvg > currentProfile.goal ? 'color-orange' : 'color-green'}">${weekAvg || '—'}</div>
      <div class="sc-sub">kcal / día</div>
    </div>
    <div class="stat-card">
      <div class="sc-label">Promedio mensual</div>
      <div class="sc-value ${monthAvg > currentProfile.goal ? 'color-orange' : 'color-green'}">${monthAvg || '—'}</div>
      <div class="sc-sub">kcal / día</div>
    </div>
    <div class="stat-card">
      <div class="sc-label">Balance del mes</div>
      <div class="sc-value ${defSign ? 'color-green' : 'color-orange'}">${defSign ? '+' : ''}${totalDeficit}</div>
      <div class="sc-sub">kcal de ${defSign ? 'déficit' : 'superávit'}</div>
    </div>
    <div class="stat-card">
      <div class="sc-label">Grasa ${defSign ? 'perdida' : 'ganada'}</div>
      <div class="sc-value ${defSign ? 'color-green' : 'color-orange'}">${gramsFat}</div>
      <div class="sc-sub">gramos estimados (≈7.700 kcal/kg)</div>
    </div>
  `;
}

// ===== SETTINGS =====
function renderSettings() {
  const p = currentProfile;
  const goalOffset = getGoalOffset(p);
  const plan = getGoalPlan(p, goalOffset);
  setText('settings-name', p.name);
  const av = document.getElementById('settings-avatar');
  if (av) av.textContent = p.name.charAt(0).toUpperCase();
  setText('settings-tdee', 'TDEE base: ' + p.tdee + ' kcal');

  const actLabels = {'1.2':'Sedentario','1.375':'Ligero','1.55':'Moderado','1.725':'Activo','1.9':'Muy activo'};
  const rows = document.getElementById('settings-rows');
  if (rows) rows.innerHTML = `
    <div class="settings-row"><span>Peso</span><span>${p.weight} kg</span></div>
    <div class="settings-row"><span>Altura</span><span>${p.height} cm</span></div>
    <div class="settings-row"><span>Edad</span><span>${p.age} años</span></div>
    <div class="settings-row"><span>Actividad</span><span>${actLabels[p.activity] || p.activity}</span></div>
    <div class="settings-row"><span>Objetivo</span><span>${plan.mode}</span></div>
    <div class="settings-row"><span>Meta diaria</span><span>${p.goal} kcal</span></div>
    <div class="settings-row"><span>Ajuste</span><span>${goalOffset > 0 ? '+' : ''}${goalOffset} kcal/día</span></div>
    <div class="settings-row"><span>API Key Gemini</span><span style="color:${p.apiKey ? 'var(--primary-dark)' : 'var(--red)'};">${p.apiKey ? 'Configurada' : 'Sin configurar'}</span></div>
  `;

  const slider = document.getElementById('settings-goal-offset');
  if (slider) slider.value = goalOffset;
  updateGoalPreview('settings', p, goalOffset);

  // Sync theme active class in settings
  const currentTheme = localStorage.getItem('nutre_theme') || 'default';
  document.querySelectorAll('.theme-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.theme === currentTheme);
  });

  renderSavedFoodsSettings();
}

function renderSavedFoodsSettings() {
  const saved = currentProfile.savedFoods || [];
  const container = document.getElementById('saved-foods-list-settings');
  const noMsg = document.getElementById('no-saved-msg');
  if (!container) return;
  if (saved.length === 0) {
    container.innerHTML = '';
    if (noMsg) noMsg.style.display = 'block';
    return;
  }
  if (noMsg) noMsg.style.display = 'none';
  container.innerHTML = saved.map((f, i) => `
    <div class="saved-food-item" style="cursor:default;">
      <div class="saved-food-info">
        <div class="saved-food-name">${escHtml(f.name)}</div>
        <div class="saved-food-meta">${f.weight ? f.weight+'g · ' : ''}P:${Math.round(f.protein||0)}g C:${Math.round(f.carbs||0)}g G:${Math.round(f.fat||0)}g</div>
      </div>
      <span class="saved-food-kcal">${f.kcal} kcal</span>
      <button class="food-edit-btn" onclick="editSavedFood(${i})" title="Editar"><i class="ph-fill ph-pencil-simple" aria-hidden="true"></i></button>
      <button class="food-delete" onclick="deleteSavedFood(${i})" title="Eliminar"><i class="ph-fill ph-trash" aria-hidden="true"></i></button>
    </div>
  `).join('');
}

function deleteSavedFood(idx) {
  const profiles = getProfiles();
  profiles[currentProfile.id].savedFoods.splice(idx, 1);
  saveProfiles(profiles);
  currentProfile = profiles[currentProfile.id];
  renderSavedFoodsSettings();
  renderSavedFoodsList();
}

function editSavedFood(idx) {
  const food = currentProfile.savedFoods[idx];
  if (!food) return;
  editingFoodId = idx;
  document.getElementById('edit-name').value = food.name;
  document.getElementById('edit-kcal').value = food.kcal;
  document.getElementById('edit-protein').value = food.protein || 0;
  document.getElementById('edit-carbs').value = food.carbs || 0;
  document.getElementById('edit-fat').value = food.fat || 0;
  document.getElementById('edit-weight').value = food.weight || '';
  showToast('Editá los valores y guardá desde Manual');
}

// ===== PAGES =====
function showPage(page) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  const pg = document.getElementById('page-' + page);
  if (pg) pg.classList.add('active');

  // Nav highlight
  document.querySelectorAll('.nav-item, .nav-link').forEach(el => {
    el.classList.toggle('active', el.dataset.page === page);
  });

  const fabEl = document.getElementById('fab');
  if (fabEl) fabEl.style.display = page === 'home' ? 'flex' : 'none';

  if (page === 'home') {
    updateHeaderDate();
    renderHome();
  }
  if (page === 'stats') renderStats();
  if (page === 'settings') renderSettings();
}

// ===== MODAL =====
function openModal(mode, foodData) {
  resetModal();
  if (mode === 'edit' && foodData) {
    editingFoodId = foodData.id;
    document.getElementById('modal-title').textContent = 'Editar comida';
    document.getElementById('manual-name').value = foodData.name;
    document.getElementById('manual-kcal').value = foodData.kcal;
    document.getElementById('manual-weight').value = foodData.weight || '';
    document.getElementById('manual-protein').value = foodData.protein || 0;
    document.getElementById('manual-carbs').value = foodData.carbs || 0;
    document.getElementById('manual-fat').value = foodData.fat || 0;
    document.getElementById('manual-add-btn').textContent = 'Guardar cambios';
    selectMealType(foodData.mealType || 'breakfast');
    switchTab('manual');
  } else {
    editingFoodId = null;
    document.getElementById('modal-title').textContent = 'Agregar comida';
    document.getElementById('manual-add-btn').textContent = 'Agregar →';
    selectMealType('breakfast');
  }
  document.getElementById('modal-overlay').classList.add('open');
  renderSavedFoodsList();
}

function closeModal() {
  document.getElementById('modal-overlay').classList.remove('open');
}

function handleOverlayClick(e) {
  if (e.target === document.getElementById('modal-overlay')) closeModal();
}

function resetModal() {
  const preview = document.getElementById('photo-preview');
  const drop = document.getElementById('photo-drop');
  if (preview) preview.style.display = 'none';
  if (drop) drop.style.display = 'block';
  document.getElementById('ai-result').style.display = 'none';
  document.getElementById('add-food-btn').style.display = 'none';
  document.getElementById('save-toggle').style.display = 'none';
  document.getElementById('loading-state').style.display = 'none';
  const loadingMessage = document.getElementById('loading-message');
  if (loadingMessage) loadingMessage.textContent = 'Analizando tu plato con IA…';
  document.getElementById('analyze-btn').disabled = true;
  const textBtn = document.getElementById('analyze-text-btn');
  if (textBtn) textBtn.disabled = true;
  document.getElementById('photo-weight').value = '';
  document.getElementById('photo-context').value = '';
  document.getElementById('photo-input').value = '';
  const textInput = document.getElementById('text-input');
  if (textInput) textInput.value = '';
  document.getElementById('ingredients-list').style.display = 'none';
  photoBase64 = null;
  aiParsedFood = null;
}

function switchTab(tab) {
  ['photo','text','manual','saved'].forEach(t => {
    document.getElementById('tab-' + t).classList.toggle('active', t === tab);
  });
  document.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.tab === tab);
  });
}

// ===== PHOTO + AI =====
function handlePhotoSelect(e) {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (ev) => {
    const img = new Image();
    img.onload = () => {
      const MAX = 1024;
      let w = img.width, h = img.height;
      if (w > MAX || h > MAX) {
        if (w > h) { h = Math.round(h * MAX / w); w = MAX; }
        else { w = Math.round(w * MAX / h); h = MAX; }
      }
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      const compressed = canvas.toDataURL('image/jpeg', 0.82);
      photoBase64 = compressed.split(',')[1];

      const preview = document.getElementById('photo-preview');
      preview.src = compressed;
      preview.style.display = 'block';
      document.getElementById('photo-drop').style.display = 'none';
      document.getElementById('analyze-btn').disabled = false;
      document.getElementById('ai-result').style.display = 'none';
      document.getElementById('add-food-btn').style.display = 'none';
      document.getElementById('save-toggle').style.display = 'none';
    };
    img.src = ev.target.result;
  };
  reader.readAsDataURL(file);
}

async function analyzePhoto() {
  if (!photoBase64) return;

  const apiKey = currentProfile.apiKey;
  if (!apiKey) {
    showToast('Configurá tu API Key de Gemini en Ajustes');
    return;
  }

  const weight = document.getElementById('photo-weight').value;
  const context = document.getElementById('photo-context').value.trim();
  const prompt = buildPhotoPrompt(weight, context);

  try {
    await runAiAnalysis({
      apiKey,
      buttonId: 'analyze-btn',
      imageBase64: photoBase64,
      prompt,
      fallbackWeight: weight,
      loadingMessage: 'Analizando tu plato con foto e IA…',
    });

  } catch (err) {
    if (err.message === 'Failed to fetch') {
      showToast('Sin conexión o API Key incorrecta');
    } else {
      showToast('Error: ' + err.message.slice(0, 60));
    }
  } finally {
    finishAiAnalysis('analyze-btn');
  }
}

async function analyzeTextFood() {
  const description = document.getElementById('text-input').value.trim();
  if (!description) {
    showToast('Escribí algo para analizar');
    return;
  }

  const apiKey = currentProfile.apiKey;
  if (!apiKey) {
    showToast('Configurá tu API Key de Gemini en Ajustes');
    return;
  }

  try {
    await runAiAnalysis({
      apiKey,
      buttonId: 'analyze-text-btn',
      prompt: buildTextPrompt(description),
      loadingMessage: 'Interpretando tu texto con IA…',
    });
  } catch (err) {
    if (err.message === 'Failed to fetch') {
      showToast('Sin conexión o API Key incorrecta');
    } else {
      showToast('Error: ' + err.message.slice(0, 60));
    }
  } finally {
    finishAiAnalysis('analyze-text-btn');
  }
}

async function runAiAnalysis({ apiKey, buttonId, prompt, imageBase64, fallbackWeight, loadingMessage }) {
  startAiAnalysis(buttonId, loadingMessage);

  const parts = [];
  if (imageBase64) parts.push({ inline_data: { mime_type: 'image/jpeg', data: imageBase64 } });
  parts.push({ text: prompt });

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts }]
      })
    }
  );

  const data = await res.json();

  if (!res.ok) {
    const msg = data?.error?.message || 'Error desconocido';
    console.error('Gemini error:', res.status, data);
    showErrorModal('Error ' + res.status, msg);
    return;
  }

  const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
  const parsed = parseAiJson(text);
  showAiFoodResult(parsed, fallbackWeight);
}

function addFoodFromAi() {
  if (!aiParsedFood) return;

  const food = {
    name: document.getElementById('edit-name').value.trim() || aiParsedFood.name,
    kcal: parseInt(document.getElementById('edit-kcal').value) || aiParsedFood.kcal,
    protein: parseFloat(document.getElementById('edit-protein').value) || aiParsedFood.protein,
    carbs: parseFloat(document.getElementById('edit-carbs').value) || aiParsedFood.carbs,
    fat: parseFloat(document.getElementById('edit-fat').value) || aiParsedFood.fat,
    weight: aiParsedFood.weight,
    ingredients: aiParsedFood.ingredients || []
  };

  if (!food.name || !food.kcal) { showToast('Completá nombre y calorías'); return; }

  if (document.getElementById('save-to-library').checked) saveToLibrary(food);
  addFood(food);
  closeModal();
  showToast(food.name + ' agregado');
}

function addFoodFromPhoto() {
  addFoodFromAi();
}
function renderIngredients(ingredients) {
  const el = document.getElementById('ingredients-list');
  if (!el || !ingredients || ingredients.length === 0) {
    if (el) el.style.display = 'none';
    return;
  }
  el.innerHTML = '<div class="ingredients-title">Composición estimada</div>' +
    ingredients.map(ing => `
      <div class="ingredient-item">
        <span class="ingredient-name">${escHtml(ing.name)}</span>
        <div class="ingredient-macros">
          <span>${ing.kcal} kcal</span>
          <span>P:${ing.protein}g</span>
          <span>C:${ing.carbs}g</span>
          <span>G:${ing.fat}g</span>
        </div>
      </div>
  `).join('');
  el.style.display = 'block';
}

// ===== MANUAL FOOD =====
function addManualFood() {
  const name = document.getElementById('manual-name').value.trim();
  const kcal = parseInt(document.getElementById('manual-kcal').value);
  if (!name || !kcal) { showToast('Completá nombre y calorías'); return; }

  const food = {
    name, kcal,
    weight: parseInt(document.getElementById('manual-weight').value) || null,
    protein: parseFloat(document.getElementById('manual-protein').value) || 0,
    carbs: parseFloat(document.getElementById('manual-carbs').value) || 0,
    fat: parseFloat(document.getElementById('manual-fat').value) || 0,
  };

  if (editingFoodId && typeof editingFoodId === 'number') {
    // Editing existing food entry (editingFoodId is a number = food.id)
    addFood(food);
    closeModal();
    showToast(food.name + ' actualizado');
  } else if (editingFoodId !== null) {
    // Editing saved food (editingFoodId is the index in savedFoods)
    const profiles = getProfiles();
    profiles[currentProfile.id].savedFoods[editingFoodId] = { name: food.name, kcal: food.kcal, protein: food.protein, carbs: food.carbs, fat: food.fat, weight: food.weight };
    saveProfiles(profiles);
    currentProfile = profiles[currentProfile.id];
    editingFoodId = null;
    closeModal();
    renderSavedFoodsSettings();
    renderSavedFoodsList();
    showToast(food.name + ' actualizado');
  } else {
    if (document.getElementById('save-manual').checked) saveToLibrary(food);
    addFood(food);
    closeModal();
    showToast(food.name + ' agregado');
  }
}

// ===== SAVED FOODS =====
function saveToLibrary(food) {
  const profiles = getProfiles();
  const p = profiles[currentProfile.id];
  if (!p.savedFoods) p.savedFoods = [];
  if (!p.savedFoods.find(f => f.name === food.name)) {
    p.savedFoods.push({ name: food.name, kcal: food.kcal, protein: food.protein, carbs: food.carbs, fat: food.fat, weight: food.weight });
    saveProfiles(profiles);
    currentProfile = profiles[currentProfile.id];
  }
}

function renderSavedFoodsList() {
  const saved = currentProfile.savedFoods || [];
  const container = document.getElementById('saved-foods-list');
  if (!container) return;
  if (saved.length === 0) {
    container.innerHTML = `<p style="font-size:13px; color:var(--ink-3); text-align:center; padding:20px 0; line-height:1.6;">
      Todavía no tenés comidas guardadas.<br>
      <small>Guardá comidas al agregarlas con foto o manualmente.</small>
    </p>`;
    return;
  }
  container.innerHTML = saved.map((f, i) => `
    <div class="saved-food-item" onclick="addSavedFood(${i})">
      <div class="saved-food-info">
        <div class="saved-food-name">${escHtml(f.name)}</div>
        <div class="saved-food-meta">${f.weight ? f.weight+'g · ' : ''}P:${Math.round(f.protein||0)}g C:${Math.round(f.carbs||0)}g G:${Math.round(f.fat||0)}g</div>
      </div>
      <span class="saved-food-kcal">${f.kcal} kcal</span>
    </div>
  `).join('');
}

function addSavedFood(idx) {
  const food = currentProfile.savedFoods[idx];
  selectMealType('breakfast');
  addFood({ ...food });
  closeModal();
  showToast(food.name + ' agregado');
}

// ===== UTILS =====
function escHtml(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function setText(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}

function setBar(id, pct) {
  const el = document.getElementById(id);
  if (el) el.style.width = Math.min(100, pct) + '%';
}

function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2800);
}

function switchProfile() { showSetup(getActiveProfileId()); }

function clearAllData() {
  if (!confirm('¿Seguro? Esto borra TODOS tus datos de este navegador.')) return;
  const id = currentProfile.id;
  Object.keys(localStorage).filter(k => k.startsWith('nutre_foods_' + id)).forEach(k => localStorage.removeItem(k));
  const profiles = getProfiles();
  delete profiles[id];
  saveProfiles(profiles);
  localStorage.removeItem('nutre_active_profile');
  location.reload();
}

// ===== ERROR MODAL =====
function showErrorModal(title, msg) {
  const old = document.getElementById('error-modal');
  if (old) old.remove();
  const el = document.createElement('div');
  el.id = 'error-modal';
  el.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:999;display:flex;align-items:center;justify-content:center;padding:24px;';
  el.innerHTML = `
    <div style="background:var(--card);border:1.5px solid var(--border);border-radius:20px;padding:28px;max-width:420px;width:100%;box-shadow:0 8px 40px rgba(0,0,0,0.2);">
      <div style="font-family:'Inter';font-size:1.1rem;font-weight:800;margin-bottom:12px;color:var(--red);">${title}</div>
      <div style="font-size:12px;color:var(--ink);background:var(--bg);border-radius:10px;padding:12px;font-family:monospace;line-height:1.6;word-break:break-word;max-height:200px;overflow-y:auto;">${msg}</div>
      <button onclick="document.getElementById('error-modal').remove()" style="margin-top:16px;width:100%;padding:10px;background:var(--btn-ink-bg);color:var(--btn-ink-color);border:none;border-radius:10px;font-family:'Inter';font-size:13px;font-weight:700;cursor:pointer;">Entendido</button>
    </div>`;
  document.body.appendChild(el);
}

// ===== THEME SWITCHER =====
function initTheme() {
  const theme = localStorage.getItem('nutre_theme') || 'default';
  setTheme(theme, false);
}

function setTheme(theme, save = true) {
  if (theme === 'default') {
    document.body.removeAttribute('data-theme');
  } else {
    document.body.setAttribute('data-theme', theme);
  }

  if (save) {
    localStorage.setItem('nutre_theme', theme);
  }

  document.querySelectorAll('.theme-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.theme === theme);
  });
}

// ===== INIT =====
window.addEventListener('load', () => {
  initTheme();
  const id = getActiveProfileId();
  const profiles = getProfiles();
  if (id && profiles[id]) loadApp();
  else showSetup();
});
