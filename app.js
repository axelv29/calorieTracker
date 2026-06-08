// ===== STATE =====
let currentProfile = null;
let currentDate = todayStr();
let selectedPhotos = [];
let aiParsedFood = null;
let aiCorrectionHistory = [];
let editingFoodId = null;
let selectedMealType = 'breakfast';

function todayStr() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
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
  try {
    return JSON.parse(clean);
  } catch (e) {
    const match = clean.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
    throw new Error('No se pudo analizar la respuesta JSON de la IA');
  }
}

function validUnit(u) {
  return (u === 'g' || u === 'kg' || u === 'ml' || u === 'L') ? u : 'g';
}

function formatWeight(value, unit) {
  if (!value && value !== 0) return '';
  const u = validUnit(unit);
  if (u === 'kg' || u === 'L') {
    const v = Number(value);
    if (v >= 1) return Math.round(v * 10) / 10 + u;
    return Math.round(v * 100) / 100 + u;
  }
  return Math.round(value) + u;
}

function roundWeight(value, unit) {
  const u = validUnit(unit);
  if (u === 'kg' || u === 'L') {
    const v = Number(value) || 0;
    return Math.round(v * 100) / 100;
  }
  return Math.round(Number(value) || 0);
}

function normalizeAiFood(food, fallbackWeight) {
  // New format: meals[] array — flatten into meals with ingredients
  if (Array.isArray(food?.meals) && food.meals.length > 0) {
    const meals = food.meals.map(m => {
      const ingredients = Array.isArray(m.ingredients) ? m.ingredients.map(i => {
        const iUnit = validUnit(i?.weightUnit);
        return {
          name: String(i?.name || '').trim(),
          count: Number(i?.count) > 0 ? Number(i.count) : null,
          unitWeight: Number(i?.unitWeight) > 0 ? roundWeight(i.unitWeight, iUnit) : null,
          weight: roundWeight(i?.weight, iUnit),
          weightUnit: iUnit,
          kcal: Math.round(Number(i?.kcal) || 0),
          protein: Math.round((Number(i?.protein) || 0) * 10) / 10,
          carbs:   Math.round((Number(i?.carbs)   || 0) * 10) / 10,
          fat:     Math.round((Number(i?.fat)      || 0) * 10) / 10,
        };
      }) : [];

      // Always recompute meal totals from its ingredients
      const kcal    = ingredients.reduce((s, i) => s + i.kcal, 0);
      const protein = Math.round(ingredients.reduce((s, i) => s + i.protein, 0) * 10) / 10;
      const carbs   = Math.round(ingredients.reduce((s, i) => s + i.carbs,   0) * 10) / 10;
      const fat     = Math.round(ingredients.reduce((s, i) => s + i.fat,     0) * 10) / 10;
      const weight  = ingredients.reduce((s, i) => s + i.weight, 0) || roundWeight(m?.weight, m?.weightUnit);
      const weightUnit = ingredients.length > 0 ? ingredients[0].weightUnit : validUnit(m?.weightUnit);

      return { name: String(m?.name || '').trim(), kcal, protein, carbs, fat, weight, weightUnit, ingredients };
    });

    // Root totals = sum of all meals
    const kcal    = meals.reduce((s, m) => s + m.kcal, 0);
    const protein = Math.round(meals.reduce((s, m) => s + m.protein, 0) * 10) / 10;
    const carbs   = Math.round(meals.reduce((s, m) => s + m.carbs,   0) * 10) / 10;
    const fat     = Math.round(meals.reduce((s, m) => s + m.fat,     0) * 10) / 10;
    const weight  = meals.reduce((s, m) => s + m.weight, 0) || null;
    const weightUnit = meals.length > 0 ? meals[0].weightUnit : 'g';
    const name    = String(food?.name || meals.map(m => m.name).join(' + ')).trim();

    const normalized = { name, kcal, protein, carbs, fat, weight, weightUnit, note: String(food?.note || '').trim(), meals };
    if (fallbackWeight && !normalized.weight) { normalized.weight = parseInt(fallbackWeight, 10); normalized.weightUnit = 'g'; }
    return normalized;
  }

  // Legacy format: flat ingredients[]
  const normalized = {
    name: String(food?.name || '').trim(),
    kcal: Math.round(Number(food?.kcal) || 0),
    protein: Number(food?.protein) || 0,
    carbs:   Number(food?.carbs)   || 0,
    fat:     Number(food?.fat)     || 0,
    weight:  food?.weight ?? null,
    weightUnit: validUnit(food?.weightUnit),
    note:    String(food?.note || '').trim(),
    meals: [],
  };

  const legacyIngredients = Array.isArray(food?.ingredients) ? food.ingredients.map(i => {
    const iUnit = validUnit(i?.weightUnit);
    return {
      name:    String(i?.name || '').trim(),
      count: Number(i?.count) > 0 ? Number(i.count) : null,
      unitWeight: Number(i?.unitWeight) > 0 ? roundWeight(i.unitWeight, iUnit) : null,
      weight:  roundWeight(i?.weight, iUnit),
      weightUnit: iUnit,
      kcal:    Math.round(Number(i?.kcal)   || 0),
      protein: Math.round((Number(i?.protein) || 0) * 10) / 10,
      carbs:   Math.round((Number(i?.carbs)   || 0) * 10) / 10,
      fat:     Math.round((Number(i?.fat)     || 0) * 10) / 10,
    };
  }) : [];

  if (legacyIngredients.length > 0) {
    const unit = legacyIngredients[0].weightUnit;
    normalized.meals = [{ name: normalized.name, kcal: normalized.kcal, protein: normalized.protein, carbs: normalized.carbs, fat: normalized.fat, weight: normalized.weight, weightUnit: unit, ingredients: legacyIngredients }];
    const sumKcal = legacyIngredients.reduce((s, i) => s + i.kcal, 0);
    if (sumKcal > 0) {
      normalized.kcal    = sumKcal;
      normalized.protein = Math.round(legacyIngredients.reduce((s, i) => s + i.protein, 0) * 10) / 10;
      normalized.carbs   = Math.round(legacyIngredients.reduce((s, i) => s + i.carbs,   0) * 10) / 10;
      normalized.fat     = Math.round(legacyIngredients.reduce((s, i) => s + i.fat,     0) * 10) / 10;
    }
  }

  if (fallbackWeight && !normalized.weight) { normalized.weight = parseInt(fallbackWeight, 10); normalized.weightUnit = 'g'; }
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

function toggleAiAnalyzeButton() {
  const desc = document.getElementById('photo-context').value.trim();
  const hasPhotos = selectedPhotos.length > 0;
  const btn = document.getElementById('analyze-btn');
  if (btn) btn.disabled = !desc && !hasPhotos;
}

function showAiFoodResult(food, fallbackWeight) {
  aiParsedFood = normalizeAiFood(food, fallbackWeight);

  document.getElementById('edit-name').value = aiParsedFood.name;
  document.getElementById('edit-kcal').value = aiParsedFood.kcal;
  document.getElementById('edit-protein').value = Math.round(aiParsedFood.protein);
  document.getElementById('edit-carbs').value = Math.round(aiParsedFood.carbs);
  document.getElementById('edit-fat').value = Math.round(aiParsedFood.fat);
  document.getElementById('res-note').textContent = aiParsedFood.note || 'Podés ajustar los valores antes de guardar.';
  renderMeals(aiParsedFood.meals);

  document.getElementById('ai-result').style.display = 'block';
  document.getElementById('save-toggle').style.display = 'flex';
  document.getElementById('add-food-btn').style.display = 'block';
}

function buildAiPrompt(description, weight) {
  const json = `{
  "reasoning": "PASO 1: veo X objetos... PASO 2: peso ref de cada uno... PASO 3: multiplico por cantidad y ajusto...",
  "name": "Nombre comida",
  "kcal": 0,
  "protein": 0,
  "carbs": 0,
  "fat": 0,
  "note": "breve nota",
  "meals": [
    {
      "name": "Nombre de la comida",
      "kcal": 0,
      "protein": 0,
      "carbs": 0,
      "fat": 0,
      "weight": 0,
      "weightUnit": "g",
      "ingredients": [
        { "name": "ingrediente", "count": 2, "unitWeight": 25, "weight": 50, "weightUnit": "g", "kcal": 0, "protein": 0, "carbs": 0, "fat": 0 }
      ]
    }
  ]
}`;
  const hasPhotos = selectedPhotos.length > 0;
  let intro = hasPhotos
    ? 'Actuá como un nutricionista profesional con acceso a tablas nutricionales detalladas. Recibís una o más fotos — cada una puede ser una comida distinta O una etiqueta nutricional.'
    : 'Actuá como un nutricionista profesional con acceso a tablas nutricionales detalladas. El usuario describió una comida sin foto.';

  let weightText = '';
  if (weight) {
    weightText = `\nEl usuario indica que la porción total pesa ${weight} gramos. Usá este dato como referencia para escalar los ingredientes.`;
  }

  let descText = '';
  if (description) {
    descText = `\n- Descripción del usuario: "${description}". Prestá MUCHA atención a las cantidades, porciones y modificaciones que mencione.`;
  }

  return `${intro}
${weightText}

PROCESO DE ANÁLISIS — seguí estos 4 pasos EN ORDEN y registrá tu razonamiento en el campo "reasoning" del JSON:

PASO 1 — DESCRIBÍ LO QUE VES EN LA FOTO:
- Describí cada comida visible: ¿cuántos objetos hay? ¿qué forma, tamaño y volumen aparente tienen?
- Compará con objetos de referencia si los hay (manos, platos, cubiertos, monedas).
- Especificá cantidades exactas: ej. "3 malteadas", "2 galletitas", "un plato de arroz".

PASO 2 — CONSULTÁ PESOS DE REFERENCIA:
Usá estos valores como base. NO te desvíes mucho de estos rangos a menos que la foto muestre claramente porciones extremas. Prestá atención: "malteada" PUEDE ser una galleta (oblea malteada) o una bebida — usá el contexto visual para decidir:
- Galleta malteada / oblea malteada (tipo Malteada de Milka o similar) → 20-30 g cada una
- Batido / malteada (bebida espumosa en vaso) → 300-400 ml
- Galletita de chocolate (chica, tipo Chips Ahoy!) → 15-20 g cada una
- Galletita con chispas (grande, estilo cookie) → 30-40 g cada una
- Manzana → 180-220 g (mediana)
- Huevo → 50-60 g cada uno
- Rebanada de pan → 30-40 g
- Arroz / pasta (porción cocida) → 150-200 g
- Papa → 200-300 g (mediana)
- Carne vacuna / cerdo (filete) → 150-250 g
- Pollo (pechuga) → 150-200 g
- Pescado (filete) → 120-180 g
- Queso (porción) → 30-50 g
- Leche (vaso) → 200-250 ml
- Gaseosa / jugo (lata) → 355 ml
- Cerveza (lata o botella chica) → 355 ml
- Pancho / salchicha → 50-80 g
- Porción de pizza (grande) → 100-150 g
- Helado (bola) → 50-70 g
- Yogur (pote) → 150-200 g
- Ensalada (plato normal) → 200-300 g
- Sopas / guisos (plato hondo) → 300-400 ml
- Tostada / pan tostado → 25-35 g
- Frutos secos (puñado) → 25-35 g
- Palta / aguacate (mediano) → 150-200 g
- Banana → 100-130 g

PASO 3 — ESTIMÁ LA CANTIDAD REAL:
- CONTÁ los objetos individuales visibles en la foto. Ej: "3 galletas malteadas", "2 galletitas de chocolate".
- Buscá el peso unitario de referencia para ese alimento en la tabla del PASO 2.
- Calculá: peso total = count × peso_unitario. Ajustá según tamaño visible (grande +30%, chico -30%).
- Ej: 3 galletas malteadas × 25 g c/u = 75 g total. 2 galletitas × 18 g c/u = 36 g total.
- IMPORTANTE: incluí "count" y "unitWeight" en el JSON para cada ingrediente.
- Si el usuario indicó peso total, usalo para escalar todo.

PASO 4 — CALCULÁ MACROS Y TOTALES:
- kcal = peso × (valor nutricional por 100g / 100).
- El total de cada comida = suma EXACTA de sus ingredientes.
- El total general = suma EXACTA de todas las comidas.

REGLAS DE UNIDADES:
- Líquidos en ml o L, sólidos en g o kg.
- Si supera 1000 g → expresalo en kg (ej: 1.5 kg).
- weightUnit debe ser "ml", "L", "g" o "kg".

ATENCIÓN A CALIFICATIVOS:
- "mitad", "poco", "chico" → ~50% de porción normal.
- "grande", "extra", "bien servido" → ~130-150%.
- "mediano", "normal", "estándar" → porción típica.
${descText}
- Si menciona cantidades exactas ("3 galletitas", "2 tostadas"), usá ese número exacto × peso unitario.

Respondé SOLO con JSON válido. El campo "reasoning" debe documentar tu análisis de los PASOS 1, 2 y 3. Los campos numéricos deben reflejar SOLO el resultado del PASO 4.
${json}`;
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
                  ${f.weight ? formatWeight(f.weight, f.weightUnit) + ' · ' : ''}P: ${Math.round(f.protein||0)}g · C: ${Math.round(f.carbs||0)}g · G: ${Math.round(f.fat||0)}g
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

  // Net balance (exercise)
  updateHomeNetBalance();
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
function calculateStreak(profileId) {
  const today = todayStr();
  const tFoods = getStorage(getFoodsKey(profileId, today)) || [];
  let startDate;

  if (tFoods.length > 0) {
    startDate = new Date(today + 'T12:00:00');
  } else {
    const y = new Date(); y.setDate(y.getDate() - 1);
    const yds = y.toISOString().split('T')[0];
    const yFoods = getStorage(getFoodsKey(profileId, yds)) || [];
    if (yFoods.length === 0) return 0;
    startDate = y;
  }

  let streak = 0;
  for (let i = 0; i < 365; i++) {
    const d = new Date(startDate); d.setDate(d.getDate() - i);
    const ds = d.toISOString().split('T')[0];
    const foods = getStorage(getFoodsKey(profileId, ds)) || [];
    if (foods.length > 0) streak++;
    else break;
  }
  return streak;
}

function calculateAdherence(profileId, goal) {
  const today = new Date(todayStr() + 'T12:00:00');
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
  const daysInMonth = today.getDate();
  let under = 0, onTrack = 0, over = 0, withData = 0;

  for (let i = 0; i < daysInMonth; i++) {
    const d = new Date(monthStart); d.setDate(d.getDate() + i);
    const foods = getStorage(getFoodsKey(profileId, d.toISOString().split('T')[0])) || [];
    const kcal = foods.reduce((s, f) => s + (f.kcal || 0), 0);
    if (kcal === 0) continue;
    withData++;
    const ratio = kcal / goal;
    if (ratio < 0.9) under++;
    else if (ratio <= 1.1) onTrack++;
    else over++;
  }

  return {
    under, onTrack, over, withData,
    underPct: withData ? (under / withData * 100) : 0,
    onTrackPct: withData ? (onTrack / withData * 100) : 0,
    overPct: withData ? (over / withData * 100) : 0
  };
}

function getWeekAverage(profileId, date) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  const monday = new Date(d); monday.setDate(diff);

  let total = 0, days = 0;
  for (let i = 0; i < 7; i++) {
    const day = new Date(monday); day.setDate(monday.getDate() + i);
    const foods = getStorage(getFoodsKey(profileId, day.toISOString().split('T')[0])) || [];
    const kcal = foods.reduce((s, f) => s + (f.kcal || 0), 0);
    if (kcal > 0) { total += kcal; days++; }
  }
  return days > 0 ? Math.round(total / days) : 0;
}

function averageMacros(profileId, daysBack) {
  const today = new Date(todayStr() + 'T12:00:00');
  let totalP = 0, totalC = 0, totalF = 0, days = 0;

  for (let i = 0; i < daysBack; i++) {
    const d = new Date(today); d.setDate(d.getDate() - i);
    const foods = getStorage(getFoodsKey(profileId, d.toISOString().split('T')[0])) || [];
    if (foods.length === 0) continue;
    days++;
    foods.forEach(f => {
      totalP += f.protein || 0;
      totalC += f.carbs || 0;
      totalF += f.fat || 0;
    });
  }

  if (days === 0) return { protein: 0, carbs: 0, fat: 0, kcal: 0, pctP: 0, pctC: 0, pctF: 0 };

  const avgP = Math.round(totalP / days);
  const avgC = Math.round(totalC / days);
  const avgF = Math.round(totalF / days);
  const kcalP = avgP * 4, kcalC = avgC * 4, kcalF = avgF * 9;
  const total = kcalP + kcalC + kcalF;

  return {
    protein: avgP, carbs: avgC, fat: avgF, kcal: total,
    pctP: total ? Math.round(kcalP / total * 100) : 0,
    pctC: total ? Math.round(kcalC / total * 100) : 0,
    pctF: total ? Math.round(kcalF / total * 100) : 0
  };
}

let statsCalendarMonth = null;

function renderCalendarHeatmap(profileId, goal, year, month) {
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const daysInMonth = lastDay.getDate();
  const startDow = firstDay.getDay(); // 0=Sun

  const monthNames = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
  const dayLabels = ['D','L','M','X','J','V','S'];

  let html = `<div class="calendar-header">
    <button class="calendar-nav-btn" onclick="changeCalendarMonth(-1)">&#8249;</button>
    <span class="calendar-month-label">${monthNames[month]} ${year}</span>
    <button class="calendar-nav-btn" onclick="changeCalendarMonth(1)">&#8250;</button>
  </div>
  <div class="calendar-heatmap">`;

  // Day of week headers
  dayLabels.forEach(l => {
    html += `<div class="heatmap-weekday-label">${l}</div>`;
  });

  // Empty cells before first day
  for (let i = 0; i < startDow; i++) {
    html += `<div></div>`;
  }

  // Day cells
  for (let d = 1; d <= daysInMonth; d++) {
    const date = new Date(year, month, d);
    const ds = date.toISOString().split('T')[0];
    const foods = getStorage(getFoodsKey(profileId, ds)) || [];
    const kcal = foods.reduce((s, f) => s + (f.kcal || 0), 0);
    const today = todayStr();

    let level = 0;
    let tooltip = `${d} — sin datos`;
    if (kcal > 0) {
      tooltip = `${d} — ${kcal} kcal`;
      const ratio = kcal / goal;
      if (ratio < 0.5) level = 1;
      else if (ratio < 0.9) level = 2;
      else if (ratio <= 1.1) level = 3;
      else level = 4;
    }

    const isToday = ds === today;
    html += `<div class="heatmap-cell${isToday ? '" style="outline:2px solid var(--primary-dark);outline-offset:-2px' : ''}" data-level="${level}" title="${tooltip.replace('—', '')}">
      <span>${d}</span>
      <span class="heatmap-tooltip">${tooltip}</span>
    </div>`;
  }

  html += `</div>`;

  // Legend
  html += `<div class="heatmap-legend">
    <span>Sin datos</span>
    <div class="heatmap-legend-cell" data-level="0"></div>
    <div class="heatmap-legend-cell" data-level="1"></div>
    <div class="heatmap-legend-cell" data-level="2"></div>
    <div class="heatmap-legend-cell" data-level="3"></div>
    <div class="heatmap-legend-cell" data-level="4"></div>
    <span>&gt;110%</span>
  </div>`;

  return html;
}

function changeCalendarMonth(dir) {
  if (!statsCalendarMonth) {
    const today = new Date();
    statsCalendarMonth = { year: today.getFullYear(), month: today.getMonth() };
  }
  statsCalendarMonth.month += dir;
  if (statsCalendarMonth.month < 0) { statsCalendarMonth.month = 11; statsCalendarMonth.year--; }
  if (statsCalendarMonth.month > 11) { statsCalendarMonth.month = 0; statsCalendarMonth.year++; }
  const el = document.getElementById('calendar-heatmap');
  if (el) {
    el.innerHTML = renderCalendarHeatmap(currentProfile.id, currentProfile.goal, statsCalendarMonth.year, statsCalendarMonth.month);
  }
}

function renderStats() {
  const today = new Date(todayStr() + 'T12:00:00');
  const dayLabels = ['D','L','M','X','J','V','S'];
  const goal = currentProfile.goal;
  const pid = currentProfile.id;

  // Big week chart
  const barsEl = document.getElementById('big-week-bars');
  let weekTotal = 0, weekDays = 0, maxKcal = 1;
  const weekData = [];

  for (let i = 6; i >= 0; i--) {
    const d = new Date(today); d.setDate(d.getDate() - i);
    const ds = d.toISOString().split('T')[0];
    const foods = getStorage(getFoodsKey(pid, ds)) || [];
    const kcal = foods.reduce((s, f) => s + (f.kcal || 0), 0);
    if (kcal > 0) { weekTotal += kcal; weekDays++; }
    if (kcal > maxKcal) maxKcal = kcal;
    weekData.push({ ds, kcal, label: dayLabels[d.getDay()], isToday: ds === todayStr() });
  }

  if (barsEl) {
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
  const tdee = currentProfile.tdee; // real energy expenditure baseline
  const daysInMonth = today.getDate();

  for (let i = 0; i < daysInMonth; i++) {
    const d = new Date(monthStart); d.setDate(d.getDate() + i);
    const ds = d.toISOString().split('T')[0];
    const foods = getStorage(getFoodsKey(pid, ds)) || [];
    const kcal = foods.reduce((s, f) => s + (f.kcal || 0), 0);
    if (kcal === 0) continue;
    monthTotal += kcal;
    monthDays++;
    totalDeficit += tdee - kcal;
  }

  const weekAvg = weekDays > 0 ? Math.round(weekTotal / weekDays) : 0;
  const monthAvg = monthDays > 0 ? Math.round(monthTotal / monthDays) : 0;
  const gramsFat = Math.round(Math.abs(totalDeficit) / 7700 * 1000);
  const defSign = totalDeficit >= 0;

  // New stats
  const streak = calculateStreak(pid);
  const adherence = calculateAdherence(pid, goal);
  const thisWeekAvg = getWeekAverage(pid, today);
  const lastWeekDate = new Date(today); lastWeekDate.setDate(today.getDate() - 7);
  const lastWeekAvg = getWeekAverage(pid, lastWeekDate);
  const macros = averageMacros(pid, 7);

  const weekDiff = thisWeekAvg - lastWeekAvg;
  let weekDiffStr, weekDiffCls;
  if (lastWeekAvg === 0) {
    weekDiffStr = 'vs semana pasada';
    weekDiffCls = 'same';
  } else {
    const pct = Math.round(Math.abs(weekDiff) / lastWeekAvg * 100);
    weekDiffStr = `${weekDiff > 0 ? '+' : ''}${weekDiff} kcal (${pct}%)`;
    weekDiffCls = weekDiff > 0 ? 'up' : weekDiff < 0 ? 'down' : 'same';
  }

  // Render stats grid
  const grid = document.getElementById('stats-grid');
  if (!grid) return;

  grid.innerHTML = `
    <div class="stat-card">
      <div class="sc-label">Promedio semanal</div>
      <div class="sc-value ${weekAvg > goal ? 'color-orange' : 'color-green'}">${weekAvg || '—'}</div>
      <div class="sc-sub">kcal / día</div>
    </div>
    <div class="stat-card">
      <div class="sc-label">Promedio mensual</div>
      <div class="sc-value ${monthAvg > goal ? 'color-orange' : 'color-green'}">${monthAvg || '—'}</div>
      <div class="sc-sub">kcal / día</div>
    </div>
    <div class="stat-card">
      <div class="sc-label">Racha actual</div>
      <div class="sc-value color-green">${streak}</div>
      <div class="sc-sub">días consecutivos registrando</div>
    </div>
    <div class="stat-card">
      <div class="sc-label">Adherencia a la meta</div>
      <div class="sc-value ${adherence.withData ? 'color-green' : ''}">${adherence.withData ? Math.round(adherence.onTrackPct) : '—'}<span class="sc-sub" style="font-size:1rem;font-weight:400;">%</span></div>
      <div class="sc-sub">días dentro del 90-110%</div>
      ${adherence.withData ? `<div class="adherence-bar-wrap">
        <div class="adherence-segment under" style="width:${adherence.underPct}%"></div>
        <div class="adherence-segment on-track" style="width:${adherence.onTrackPct}%"></div>
        <div class="adherence-segment over" style="width:${adherence.overPct}%"></div>
      </div>
      <div class="adherence-legend">
        <span class="adherence-legend-item"><span class="adherence-legend-dot under"></span>Bajo ${adherence.under}</span>
        <span class="adherence-legend-item"><span class="adherence-legend-dot on-track"></span>Meta ${adherence.onTrack}</span>
        <span class="adherence-legend-item"><span class="adherence-legend-dot over"></span>Exceso ${adherence.over}</span>
      </div>` : '<div style="font-size:11px;color:var(--ink-3);margin-top:6px;">Registrá comidas para ver adherencia</div>'}
    </div>
    <div class="stat-card sc-span2">
      <div class="sc-label">Balance real del mes</div>
      <div class="sc-value ${defSign ? 'color-green' : 'color-orange'}">${defSign ? '+' : ''}${totalDeficit}</div>
      <div class="sc-sub">kcal de ${defSign ? 'déficit' : 'superávit'} vs tu TDEE (${tdee} kcal)</div>
    </div>
    <div class="stat-card sc-span2">
      <div class="sc-label">Grasa ${defSign ? 'perdida' : 'ganada'}</div>
      <div class="sc-value ${defSign ? 'color-green' : 'color-orange'}">${gramsFat}</div>
      <div class="sc-sub">gramos estimados (≈7.700 kcal/kg)</div>
    </div>
    <div class="stat-card">
      <div class="sc-label">Comparación semanal</div>
      <div class="week-comp-value ${thisWeekAvg > goal ? 'color-orange' : 'color-green'}">${thisWeekAvg || '—'}</div>
      <div class="week-comp-change ${weekDiffCls}">${weekDiffStr}</div>
    </div>
    <div class="stat-card">
      <div class="sc-label">Macros promedio</div>
      <div class="sc-value" style="font-size:1.2rem;display:flex;gap:12px;justify-content:center;flex-wrap:wrap;">${macros.protein || '—'}<span class="sc-sub" style="font-size:0.7rem;">p</span><span style="color:var(--border);font-weight:300;">|</span> ${macros.carbs || '—'}<span class="sc-sub" style="font-size:0.7rem;">c</span><span style="color:var(--border);font-weight:300;">|</span> ${macros.fat || '—'}<span class="sc-sub" style="font-size:0.7rem;">g</span></div>
      <div class="sc-sub">proteína · carbos · grasas (g)</div>
    </div>
  `;

  // Macro breakdown section
  const macroSection = document.getElementById('macro-breakdown');
  if (macroSection && macros.kcal > 0) {
    const maxGrams = Math.max(macros.protein, macros.carbs, macros.fat, 1);
    macroSection.innerHTML = `
      <div class="stats-section">
        <div class="card-title">Distribución de macronutrientes</div>
        <div class="macro-breakdown-item">
          <div class="macro-bd-header">
            <span class="macro-bd-label">Proteínas</span>
            <span class="macro-bd-values">${macros.protein}g · ${macros.pctP}%</span>
          </div>
          <div class="macro-bd-bar-bg">
            <div class="macro-bd-bar-fill protein" style="width:${macros.protein / maxGrams * 100}%"></div>
          </div>
        </div>
        <div class="macro-breakdown-item">
          <div class="macro-bd-header">
            <span class="macro-bd-label">Carbohidratos</span>
            <span class="macro-bd-values">${macros.carbs}g · ${macros.pctC}%</span>
          </div>
          <div class="macro-bd-bar-bg">
            <div class="macro-bd-bar-fill carbs" style="width:${macros.carbs / maxGrams * 100}%"></div>
          </div>
        </div>
        <div class="macro-breakdown-item">
          <div class="macro-bd-header">
            <span class="macro-bd-label">Grasas</span>
            <span class="macro-bd-values">${macros.fat}g · ${macros.pctF}%</span>
          </div>
          <div class="macro-bd-bar-bg">
            <div class="macro-bd-bar-fill fat" style="width:${macros.fat / maxGrams * 100}%"></div>
          </div>
        </div>
        <div class="macro-bd-summary">
          <span class="macro-bd-summary-item"><span class="macro-bd-summary-dot protein"></span>${macros.protein}g proteína</span>
          <span class="macro-bd-summary-item"><span class="macro-bd-summary-dot carbs"></span>${macros.carbs}g carbohidratos</span>
          <span class="macro-bd-summary-item"><span class="macro-bd-summary-dot fat"></span>${macros.fat}g grasas</span>
        </div>
      </div>
    `;
  } else if (macroSection) {
    macroSection.innerHTML = '';
  }

  // Calendar heatmap
  const calEl = document.getElementById('calendar-heatmap');
  if (calEl) {
    if (!statsCalendarMonth) {
      statsCalendarMonth = { year: today.getFullYear(), month: today.getMonth() };
    }
    calEl.innerHTML = renderCalendarHeatmap(pid, goal, statsCalendarMonth.year, statsCalendarMonth.month);
  }
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
  const exFabEl = document.getElementById('exercise-fab');
  if (exFabEl) exFabEl.style.display = page === 'exercise' ? 'flex' : 'none';

  // Sidebar: toggle which add button is visible
  const sidebarFood = document.getElementById('sidebar-add-food-btn');
  const sidebarExercise = document.getElementById('sidebar-add-exercise-btn');
  if (sidebarFood) sidebarFood.style.display = page === 'exercise' ? 'none' : 'flex';
  if (sidebarExercise) sidebarExercise.style.display = page === 'exercise' ? 'flex' : 'none';

  if (page === 'home') {
    updateHeaderDate();
    renderHome();
  }
  if (page === 'stats') renderStats();
  if (page === 'settings') renderSettings();
  if (page === 'exercise') {
    updateHeaderDate();
    renderExercisePage();
    renderExerciseStats();
  }
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
  const previews = document.getElementById('photo-previews');
  const drop = document.getElementById('photo-drop');
  if (previews) { previews.innerHTML = ''; previews.style.display = 'none'; }
  if (drop) drop.classList.remove('has-photos');
  document.getElementById('ai-result').style.display = 'none';
  document.getElementById('add-food-btn').style.display = 'none';
  document.getElementById('save-toggle').style.display = 'none';
  document.getElementById('loading-state').style.display = 'none';
  document.getElementById('correction-section').style.display = 'none';
  document.getElementById('correction-input').value = '';
  const loadingMessage = document.getElementById('loading-message');
  if (loadingMessage) loadingMessage.textContent = 'Analizando tu plato con IA…';
  document.getElementById('analyze-btn').disabled = true;
  document.getElementById('photo-weight').value = '';
  document.getElementById('photo-context').value = '';
  document.getElementById('photo-input').value = '';
  document.getElementById('ingredients-list').style.display = 'none';
  selectedPhotos = [];
  aiParsedFood = null;
  aiCorrectionHistory = [];
}

function switchTab(tab) {
  ['photo','manual','saved'].forEach(t => {
    document.getElementById('tab-' + t).classList.toggle('active', t === tab);
  });
  document.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.tab === tab);
  });
}

// ===== PHOTO + AI =====
function handlePhotoSelect(e) {
  const files = Array.from(e.target.files);
  if (!files.length) return;

  const MAX = 1024;
  const QUALITY = 0.82;
  let loaded = 0;

  files.forEach((file) => {
    const reader = new FileReader();
    reader.onload = (ev) => {
      const img = new Image();
      img.onload = () => {
        let w = img.width, h = img.height;
        if (w > MAX || h > MAX) {
          if (w > h) { h = Math.round(h * MAX / w); w = MAX; }
          else { w = Math.round(w * MAX / h); h = MAX; }
        }
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        const compressed = canvas.toDataURL('image/jpeg', QUALITY);
        selectedPhotos.push({
          id: Date.now() + '_' + loaded,
          base64: compressed.split(',')[1],
          dataUrl: compressed
        });
        loaded++;
        if (loaded === files.length) onAllPhotosLoaded();
      };
      img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
  });
}

function onAllPhotosLoaded() {
  renderPhotoPreviews();
  document.getElementById('photo-drop').classList.add('has-photos');
  document.getElementById('analyze-btn').disabled = false;
  document.getElementById('ai-result').style.display = 'none';
  document.getElementById('add-food-btn').style.display = 'none';
  document.getElementById('save-toggle').style.display = 'none';
  document.getElementById('correction-section').style.display = 'none';
  toggleAiAnalyzeButton();
}

function renderPhotoPreviews() {
  const container = document.getElementById('photo-previews');
  container.innerHTML = selectedPhotos.map((p, i) => `
    <div class="photo-preview-thumb">
      <img src="${p.dataUrl}" alt="foto ${i + 1}" />
      <button class="photo-preview-del" onclick="removePhoto(${i})" title="Eliminar foto">&times;</button>
      <span class="photo-preview-idx">${i + 1}</span>
    </div>
  `).join('') + `
    <div class="photo-preview-plus" onclick="addMorePhotos()" title="Agregar más fotos">
      <span>+</span>
    </div>
  `;
  container.style.display = 'flex';
}

function removePhoto(index) {
  selectedPhotos.splice(index, 1);
  if (selectedPhotos.length === 0) {
    document.getElementById('photo-previews').style.display = 'none';
    document.getElementById('photo-drop').classList.remove('has-photos');
    document.getElementById('ai-result').style.display = 'none';
    document.getElementById('add-food-btn').style.display = 'none';
    document.getElementById('save-toggle').style.display = 'none';
    document.getElementById('correction-section').style.display = 'none';
  } else {
    renderPhotoPreviews();
  }
  toggleAiAnalyzeButton();
}

function addMorePhotos() {
  const input = document.getElementById('photo-input');
  input.value = '';
  input.click();
}

async function analyzeAiFood() {
  const description = document.getElementById('photo-context').value.trim();
  const hasPhotos = selectedPhotos.length > 0;

  if (!description && !hasPhotos) {
    showToast('Subí una foto o escribí una descripción');
    return;
  }

  const apiKey = currentProfile.apiKey;
  if (!apiKey) {
    showToast('Configurá tu API Key de Gemini en Ajustes');
    return;
  }

  const weight = document.getElementById('photo-weight').value;
  const prompt = buildAiPrompt(description, weight);

  try {
    await runAiAnalysis({
      apiKey,
      buttonId: 'analyze-btn',
      images: hasPhotos ? selectedPhotos.map(p => p.base64) : [],
      prompt,
      fallbackWeight: weight,
      loadingMessage: hasPhotos
        ? 'Analizando fotos y descripción con IA…'
        : 'Analizando descripción con IA…',
    });
    aiCorrectionHistory = [];
    document.getElementById('correction-section').style.display = 'block';
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

function buildCorrectionPrompt(correction, currentFood) {
  const hasPhotos = selectedPhotos.length > 0;
  const jsonFormat = `{
  "name": "Nombre comida",
  "kcal": 0,
  "protein": 0,
  "carbs": 0,
  "fat": 0,
  "note": "breve nota",
  "meals": [
    {
      "name": "Nombre de la comida",
      "kcal": 0,
      "protein": 0,
      "carbs": 0,
      "fat": 0,
      "weight": 0,
      "weightUnit": "g",
      "ingredients": [
        { "name": "ingrediente", "weight": 0, "weightUnit": "g", "kcal": 0, "protein": 0, "carbs": 0, "fat": 0 }
      ]
    }
  ]
}`;

  let historyText = '';
  if (aiCorrectionHistory.length > 0) {
    historyText = '\n\nCORRECCIONES ANTERIORES (aplicadas secuencialmente):\n';
    aiCorrectionHistory.forEach((h, i) => {
      historyText += `${i + 1}. "${h.text}" → Resultó en: kcal=${h.result.kcal}, proteinas=${h.result.protein}g, carbs=${h.result.carbs}g, grasas=${h.result.fat}g\n`;
    });
    historyText += '\n';
  }

  return `Actuá como un nutricionista profesional. Ya analicé una comida${hasPhotos ? ' con foto(s)' : ''} y obtuve esta estimación actual:

Nombre: "${currentFood.name}"
Calorías: ${currentFood.kcal} kcal
Proteína: ${currentFood.protein}g
Carbohidratos: ${currentFood.carbs}g
Grasas: ${currentFood.fat}g
${historyText}
El usuario ACABA de indicar la siguiente corrección ADICIONAL: "${correction}"

IMPORTANTE: Esta corrección es ACUMULATIVA. Aplica este cambio SOBRE el resultado actual (que ya incorpora correcciones anteriores si las hay). No reviertas cambios previos.

Re-analizá las fotos teniendo en cuenta TODO el historial y la nueva corrección. Devolvé SOLO un JSON válido, sin markdown ni texto extra, con el siguiente formato (el mismo del análisis original):
${jsonFormat}`;
}

async function correctAiResult() {
  const correction = document.getElementById('correction-input').value.trim();
  if (!correction) { showToast('Escribí qué corregir'); return; }

  const apiKey = currentProfile.apiKey;
  if (!apiKey) { showToast('Configurá tu API Key de Gemini en Ajustes'); return; }

  const prevFood = aiParsedFood;
  const currentFood = {
    name: document.getElementById('edit-name').value.trim() || (prevFood ? prevFood.name : ''),
    kcal: parseInt(document.getElementById('edit-kcal').value) || (prevFood ? prevFood.kcal : 0),
    protein: parseFloat(document.getElementById('edit-protein').value) || (prevFood ? prevFood.protein : 0),
    carbs: parseFloat(document.getElementById('edit-carbs').value) || (prevFood ? prevFood.carbs : 0),
    fat: parseFloat(document.getElementById('edit-fat').value) || (prevFood ? prevFood.fat : 0),
  };

  const prompt = buildCorrectionPrompt(correction, currentFood);
  const btn = document.getElementById('correction-btn');
  if (btn) btn.disabled = true;

  try {
    await runAiAnalysis({
      apiKey,
      buttonId: 'correction-btn',
      images: selectedPhotos.length > 0 ? selectedPhotos.map(p => p.base64) : [],
      prompt,
      loadingMessage: 'Aplicando corrección…',
    });
    // Track correction history for context in future corrections
    if (aiParsedFood) {
      aiCorrectionHistory.push({ text: correction, result: { name: aiParsedFood.name, kcal: aiParsedFood.kcal, protein: aiParsedFood.protein, carbs: aiParsedFood.carbs, fat: aiParsedFood.fat } });
    }
    document.getElementById('correction-input').value = '';
  } catch (err) {
    if (err.message === 'Failed to fetch') {
      showToast('Sin conexión o API Key incorrecta');
    } else {
      showToast('Error: ' + err.message.slice(0, 60));
    }
  } finally {
    finishAiAnalysis('correction-btn');
  }
}

async function runAiAnalysis({ apiKey, buttonId, prompt, images, imageBase64, fallbackWeight, loadingMessage }) {
  startAiAnalysis(buttonId, loadingMessage);

  const parts = [];
  const allImages = images || (imageBase64 ? [imageBase64] : []);
  allImages.forEach(b64 => {
    parts.push({ inline_data: { mime_type: 'image/jpeg', data: b64 } });
  });
  parts.push({ text: prompt });

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: {
          parts: [{ text: 'Sos un nutricionista profesional con acceso a tablas nutricionales detalladas. Respondé ÚNICAMENTE con JSON válido, sin markdown ni texto extra.' }]
        },
        contents: [{ parts }],
        generationConfig: {
          temperature: 0.05,
          topP: 0.95,
        }
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
    weightUnit: aiParsedFood.weightUnit || 'g',
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
  // Legacy shim — wrap in a single meal
  if (!ingredients || ingredients.length === 0) {
    const el = document.getElementById('ingredients-list');
    if (el) el.style.display = 'none';
    return;
  }
  renderMeals([{ name: '', ingredients }]);
}

function renderMeals(meals) {
  const el = document.getElementById('ingredients-list');
  if (!el || !meals || meals.length === 0) {
    if (el) el.style.display = 'none';
    return;
  }

  const multiMeal = meals.length > 1;

  el.innerHTML = meals.map(meal => {
    const hasIngredients = meal.ingredients && meal.ingredients.length > 0;
    const mealWeight = meal.weight ? `<span class="ingredient-meal-weight">${formatWeight(meal.weight, meal.weightUnit)} total</span>` : '';

    const header = multiMeal || meal.name
      ? `<div class="ingredient-meal-header">
          <span class="ingredient-meal-name">${escHtml(meal.name)}</span>
          ${mealWeight}
         </div>`
      : '';

    const rows = hasIngredients ? meal.ingredients.map(ing => `
      <div class="ingredient-item">
        <div class="ingredient-name-col">
          <span class="ingredient-name">${escHtml(ing.name)}</span>
          ${ing.weight ? `<span class="ingredient-weight">${ing.count ? ing.count + ' × ' + formatWeight(ing.unitWeight, ing.weightUnit) + ' = ' : ''}${formatWeight(ing.weight, ing.weightUnit)}</span>` : ''}
        </div>
        <div class="ingredient-macros">
          <span class="ing-kcal">${ing.kcal} kcal</span>
          <span>P:${ing.protein}g</span>
          <span>C:${ing.carbs}g</span>
          <span>G:${ing.fat}g</span>
        </div>
      </div>`).join('') : '';

    const mealTotal = hasIngredients && multiMeal ? `
      <div class="ingredient-meal-total">
        <span>Total ${escHtml(meal.name)}</span>
        <span>${meal.kcal} kcal · P:${meal.protein}g · C:${meal.carbs}g · G:${meal.fat}g</span>
      </div>` : '';

    return `<div class="ingredient-meal-block">${header}${rows}${mealTotal}</div>`;
  }).join('');

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
    weightUnit: 'g',
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
    profiles[currentProfile.id].savedFoods[editingFoodId] = { name: food.name, kcal: food.kcal, protein: food.protein, carbs: food.carbs, fat: food.fat, weight: food.weight, weightUnit: food.weightUnit };
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
    p.savedFoods.push({ name: food.name, kcal: food.kcal, protein: food.protein, carbs: food.carbs, fat: food.fat, weight: food.weight, weightUnit: food.weightUnit || 'g' });
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
        <div class="saved-food-meta">${f.weight ? formatWeight(f.weight, f.weightUnit) + ' · ' : ''}P:${Math.round(f.protein||0)}g C:${Math.round(f.carbs||0)}g G:${Math.round(f.fat||0)}g</div>
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

// ===== EXERCISE MODULE =====

const EXERCISE_TYPES = {
  cardio: 'Cardio',
  strength: 'Fuerza',
  hiit: 'HIIT',
  flexibility: 'Flexibilidad / yoga',
  sport: 'Deporte',
  other: 'Otro'
};

let selectedExerciseType = 'cardio';
let aiParsedExercise = null;

function getExercisesKey(profileId, date) { return `nutre_exercises_${profileId}_${date}`; }
function getExercises(date) { return getStorage(getExercisesKey(currentProfile.id, date)) || []; }
function saveExercises(date, exercises) { setStorage(getExercisesKey(currentProfile.id, date), exercises); }

function addExercise(exercise) {
  const exercises = getExercises(currentDate);
  exercises.push({ ...exercise, id: Date.now(), type: selectedExerciseType });
  saveExercises(currentDate, exercises);
  renderExercisePage();
  renderHome(); // update net balance in home
}

function deleteExercise(id) {
  const exercises = getExercises(currentDate).filter(e => e.id !== id);
  saveExercises(currentDate, exercises);
  renderExercisePage();
  renderHome();
}

function selectExerciseType(type) {
  selectedExerciseType = type;
  document.querySelectorAll('.exercise-pill').forEach(b => {
    b.classList.toggle('active', b.dataset.type === type);
  });
}

function getTotalBurned(date) {
  return getExercises(date).reduce((s, e) => s + (e.kcalBurned || 0), 0);
}

function buildExercisePrompt(description) {
  const p = currentProfile;
  return `Actuá como un especialista en fisiología del ejercicio. Estimá el gasto calórico del ejercicio descrito por el usuario.

Datos físicos del usuario:
- Peso: ${p.weight} kg
- Altura: ${p.height} cm
- Edad: ${p.age} años
- Sexo: ${p.sex === 'm' ? 'Masculino' : 'Femenino'}

Descripción del ejercicio: "${description}"

Consideraciones:
- Si no se menciona duración, asumí una sesión típica (30-45 minutos para cardio, 45-60 para fuerza).
- Ajustá el gasto según el peso corporal del usuario.
- Incluí una estimación de calorías quemadas durante el ejercicio (sin contar el metabolismo basal).
- Si la descripción es vaga, elegí una intensidad moderada.

Respondé SOLO con un JSON válido, sin markdown ni texto extra, con este formato exacto:
{
  "name": "nombre descriptivo del ejercicio",
  "kcalBurned": número entero de calorías quemadas,
  "duration": número en minutos o null,
  "intensity": "baja" | "moderada" | "alta",
  "note": "breve explicación del cálculo"
}`;
}

async function analyzeExercise() {
  const description = document.getElementById('exercise-text-input').value.trim();
  if (!description) { showToast('Describí el ejercicio primero'); return; }

  const apiKey = currentProfile.apiKey;
  if (!apiKey) { showToast('Configurá tu API Key de Gemini en Ajustes'); return; }

  const btn = document.getElementById('analyze-exercise-btn');
  const loading = document.getElementById('exercise-loading-state');
  const result = document.getElementById('exercise-ai-result');
  const addBtn = document.getElementById('add-exercise-btn');

  if (btn) btn.disabled = true;
  if (loading) loading.style.display = 'block';
  if (result) result.style.display = 'none';
  if (addBtn) addBtn.style.display = 'none';

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: buildExercisePrompt(description) }] }] })
      }
    );
    const data = await res.json();
    if (!res.ok) { showErrorModal('Error ' + res.status, data?.error?.message || 'Error desconocido'); return; }

    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    aiParsedExercise = parseAiJson(text);

    // Fill editable fields
    document.getElementById('exercise-edit-name').value = aiParsedExercise.name || '';
    document.getElementById('exercise-edit-kcal').value = aiParsedExercise.kcalBurned || 0;
    document.getElementById('exercise-edit-duration').value = aiParsedExercise.duration || '';
    document.getElementById('exercise-res-note').textContent = aiParsedExercise.note || '';

    if (result) result.style.display = 'block';
    if (addBtn) addBtn.style.display = 'block';

  } catch (err) {
    showToast(err.message === 'Failed to fetch' ? 'Sin conexión o API Key incorrecta' : 'Error: ' + err.message.slice(0, 60));
  } finally {
    if (btn) btn.disabled = false;
    if (loading) loading.style.display = 'none';
  }
}

function addExerciseFromAi() {
  if (!aiParsedExercise) return;
  const exercise = {
    name: document.getElementById('exercise-edit-name').value.trim() || aiParsedExercise.name,
    kcalBurned: parseInt(document.getElementById('exercise-edit-kcal').value) || aiParsedExercise.kcalBurned,
    duration: parseInt(document.getElementById('exercise-edit-duration').value) || aiParsedExercise.duration || null,
    intensity: aiParsedExercise.intensity || 'moderada',
    note: aiParsedExercise.note || '',
  };
  if (!exercise.name || !exercise.kcalBurned) { showToast('Faltan datos del ejercicio'); return; }
  addExercise(exercise);
  closeExerciseModal();
  showToast(exercise.name + ' registrado — −' + exercise.kcalBurned + ' kcal');
}

function addManualExercise() {
  const name = document.getElementById('exercise-manual-name').value.trim();
  const kcalBurned = parseInt(document.getElementById('exercise-manual-kcal').value);
  if (!name || !kcalBurned) { showToast('Completá nombre y calorías'); return; }
  const exercise = {
    name, kcalBurned,
    duration: parseInt(document.getElementById('exercise-manual-duration').value) || null,
    intensity: 'moderada',
    note: '',
  };
  addExercise(exercise);
  closeExerciseModal();
  showToast(exercise.name + ' registrado — −' + exercise.kcalBurned + ' kcal');
}

function openExerciseModal() {
  resetExerciseModal();
  document.getElementById('exercise-modal-overlay').classList.add('open');
}

function closeExerciseModal() {
  document.getElementById('exercise-modal-overlay').classList.remove('open');
}

function resetExerciseModal() {
  const textInput = document.getElementById('exercise-text-input');
  if (textInput) textInput.value = '';
  const result = document.getElementById('exercise-ai-result');
  if (result) result.style.display = 'none';
  const loading = document.getElementById('exercise-loading-state');
  if (loading) loading.style.display = 'none';
  const addBtn = document.getElementById('add-exercise-btn');
  if (addBtn) addBtn.style.display = 'none';
  const btn = document.getElementById('analyze-exercise-btn');
  if (btn) btn.disabled = true;
  // Manual fields
  ['exercise-manual-name','exercise-manual-kcal','exercise-manual-duration'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  aiParsedExercise = null;
  selectedExerciseType = 'cardio';
  document.querySelectorAll('.exercise-pill').forEach(b => {
    b.classList.toggle('active', b.dataset.type === 'cardio');
  });
  switchExerciseTab('ai');
}

function switchExerciseTab(tab) {
  ['ai','manual'].forEach(t => {
    const el = document.getElementById('exercise-tab-' + t);
    if (el) el.classList.toggle('active', t === tab);
  });
  document.querySelectorAll('.exercise-tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tab);
  });
}

function toggleExerciseAnalyzeBtn() {
  const input = document.getElementById('exercise-text-input');
  const btn = document.getElementById('analyze-exercise-btn');
  if (btn && input) btn.disabled = !input.value.trim();
}

function renderExercisePage() {
  const exercises = getExercises(currentDate);
  const totalBurned = exercises.reduce((s, e) => s + (e.kcalBurned || 0), 0);
  const totalFoods = getFoods(currentDate).reduce((s, f) => s + (f.kcal || 0), 0);
  const netBalance = totalFoods - currentProfile.goal + totalBurned;

  // Update ring
  const ring = document.getElementById('exercise-ring-progress');
  if (ring) {
    const target = Math.max(300, currentProfile.goal * 0.2); // ~20% of goal as exercise target
    const pct = Math.min(totalBurned / target, 1);
    const C = 2 * Math.PI * 40;
    ring.style.strokeDashoffset = C - pct * C;
  }

  // Extra stats
  const kcalInEl = document.getElementById('exercise-kcal-in');
  if (kcalInEl) kcalInEl.textContent = totalFoods + ' kcal';
  const adjGoalEl = document.getElementById('exercise-adjusted-goal');
  if (adjGoalEl) adjGoalEl.textContent = (currentProfile.goal + totalBurned) + ' kcal';

  const burnedEl = document.getElementById('exercise-total-burned');
  if (burnedEl) burnedEl.textContent = totalBurned;

  const netEl = document.getElementById('exercise-net-balance-val');
  if (netEl) {
    const netFromGoal = totalFoods - (currentProfile.goal + totalBurned);
    netEl.textContent = (netFromGoal > 0 ? '+' : '') + netFromGoal + ' kcal';
    netEl.className = 'exercise-net-value ' + (netFromGoal <= 0 ? 'color-green' : 'color-orange');
  }

  const sessEl = document.getElementById('exercise-sessions-today');
  if (sessEl) sessEl.textContent = exercises.length;

  // Exercise list
  const list = document.getElementById('exercise-list');
  if (!list) return;

  if (exercises.length === 0) {
    list.innerHTML = `<div class="empty-state">
      <p>Sin ejercicios registrados hoy.<br>Tocá <strong>+ Agregar ejercicio</strong> para empezar.</p>
    </div>`;
  } else {
    const typeIcons = { cardio: '🏃', strength: '🏋️', hiit: '⚡', flexibility: '🧘', sport: '⚽', other: '💪' };
    list.innerHTML = exercises.map(e => `
      <div class="exercise-item">
        <div class="exercise-icon">${typeIcons[e.type] || '💪'}</div>
        <div class="exercise-info">
          <div class="exercise-name">${escHtml(e.name)}</div>
          <div class="exercise-meta">
            ${EXERCISE_TYPES[e.type] || 'Otro'}${e.duration ? ' · ' + e.duration + ' min' : ''}${e.intensity ? ' · intensidad ' + e.intensity : ''}
          </div>
        </div>
        <span class="exercise-kcal-badge">−${e.kcalBurned} kcal</span>
        <button class="exercise-delete" onclick="deleteExercise(${e.id})" title="Eliminar">
          <i class="ph-fill ph-trash" aria-hidden="true"></i>
        </button>
      </div>
    `).join('');
  }

  // Week chart
  renderExerciseWeekChart();

  // Also update home net balance if visible
  updateHomeNetBalance();
}

function renderExerciseWeekChart() {
  const el = document.getElementById('exercise-week-bars');
  if (!el) return;
  const today = new Date(todayStr() + 'T12:00:00');
  const dayLabels = ['D','L','M','X','J','V','S'];
  const weekData = [];
  let maxKcal = 1;

  for (let i = 6; i >= 0; i--) {
    const d = new Date(today); d.setDate(d.getDate() - i);
    const ds = d.toISOString().split('T')[0];
    const exercises = getStorage(getExercisesKey(currentProfile.id, ds)) || [];
    const kcal = exercises.reduce((s, e) => s + (e.kcalBurned || 0), 0);
    if (kcal > maxKcal) maxKcal = kcal;
    weekData.push({ kcal, label: dayLabels[d.getDay()], isToday: ds === todayStr() });
  }

  el.innerHTML = weekData.map(({ kcal, label, isToday }) => {
    const pct = kcal > 0 ? Math.max(8, (kcal / maxKcal) * 70) : 4;
    const cls = kcal === 0 ? 'empty' : isToday ? 'today' : '';
    return `<div class="ex-bar-col">
      <span class="ex-bar-val">${kcal > 0 ? kcal : ''}</span>
      <div class="ex-bar ${cls}" style="height:${pct}px"></div>
      <span class="ex-bar-label">${label}</span>
    </div>`;
  }).join('');
}

function updateHomeNetBalance() {
  const el = document.getElementById('home-net-balance');
  if (!el) return;
  const foods = getFoods(currentDate);
  const exercises = getExercises(currentDate);
  const totalIn = foods.reduce((s, f) => s + (f.kcal || 0), 0);
  const totalBurned = exercises.reduce((s, e) => s + (e.kcalBurned || 0), 0);
  if (totalBurned === 0) { el.style.display = 'none'; return; }

  el.style.display = 'flex';
  const netFromGoal = totalIn - (currentProfile.goal + totalBurned);
  const valEl = document.getElementById('home-net-balance-val');
  if (valEl) {
    valEl.textContent = (netFromGoal > 0 ? '+' : '') + netFromGoal + ' kcal';
    valEl.className = 'net-balance-value ' + (netFromGoal <= 0 ? 'color-green' : 'color-orange');
  }
  // Update sub text via the second child div
  const subDivs = el.querySelectorAll('div');
  if (subDivs[1]) subDivs[1].textContent = `Ingeridas ${totalIn} · Quemadas ${totalBurned} · Meta ${currentProfile.goal}`;
}

function renderExerciseStats() {
  const today = new Date(todayStr() + 'T12:00:00');
  const pid = currentProfile.id;
  let weekBurned = 0, weekSessions = 0, monthBurned = 0, monthSessions = 0;

  for (let i = 0; i < 7; i++) {
    const d = new Date(today); d.setDate(d.getDate() - i);
    const exercises = getStorage(getExercisesKey(pid, d.toISOString().split('T')[0])) || [];
    const kcal = exercises.reduce((s, e) => s + (e.kcalBurned || 0), 0);
    weekBurned += kcal;
    if (kcal > 0) weekSessions += exercises.length;
  }

  const daysInMonth = today.getDate();
  for (let i = 0; i < daysInMonth; i++) {
    const d = new Date(today.getFullYear(), today.getMonth(), 1); d.setDate(d.getDate() + i);
    const exercises = getStorage(getExercisesKey(pid, d.toISOString().split('T')[0])) || [];
    const kcal = exercises.reduce((s, e) => s + (e.kcalBurned || 0), 0);
    monthBurned += kcal;
    if (kcal > 0) monthSessions += exercises.length;
  }

  const grid = document.getElementById('exercise-stats-grid');
  if (!grid) return;

  grid.innerHTML = `
    <div class="stat-card">
      <div class="sc-label">Quemado esta semana</div>
      <div class="sc-value color-green">${weekBurned || '—'}</div>
      <div class="sc-sub">kcal totales</div>
    </div>
    <div class="stat-card">
      <div class="sc-label">Sesiones esta semana</div>
      <div class="sc-value color-green">${weekSessions || '—'}</div>
      <div class="sc-sub">ejercicios registrados</div>
    </div>
    <div class="stat-card">
      <div class="sc-label">Quemado este mes</div>
      <div class="sc-value color-green">${monthBurned || '—'}</div>
      <div class="sc-sub">kcal totales</div>
    </div>
    <div class="stat-card">
      <div class="sc-label">Sesiones este mes</div>
      <div class="sc-value color-green">${monthSessions || '—'}</div>
      <div class="sc-sub">ejercicios registrados</div>
    </div>
  `;
}

// ===== EXPORT / IMPORT =====

let pendingImportData = null;

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
  // 'all' — scan localStorage for all dates belonging to this profile
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

      // Build preview
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

  // Import foods — merge per day without duplicating by id
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

  // Import exercises — same merge
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

  // Import saved foods — merge by name
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

  // Reset UI
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

  // Refresh current view
  renderHome();
  updateExportPreview();
}

// Initialize export preview when settings page opens
const _origRenderSettings = renderSettings;
renderSettings = function() {
  _origRenderSettings();
  // Set default dates for range picker
  const today = todayStr();
  const fromEl = document.getElementById('export-date-from');
  const toEl   = document.getElementById('export-date-to');
  if (fromEl && !fromEl.value) fromEl.value = today;
  if (toEl   && !toEl.value)   toEl.value   = today;
  updateExportPreview();
};
