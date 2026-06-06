// ============================================================
// ai.js — Análisis de comida con IA Gemini: prompts, API, parsing,
//         correcciones, manejo de fotos
// Dependencias: state.js, utils.js, nutrition.js
// ============================================================

// ===== NORMALIZE AI RESPONSE =====

// Normaliza la respuesta de la IA a un formato consistente con meals[]
function normalizeAiFood(food, fallbackWeight) {
  if (Array.isArray(food?.meals) && food.meals.length > 0) {
    const meals = food.meals.map(m => {
      const ingredients = Array.isArray(m.ingredients) ? m.ingredients.map(i => {
        const iUnit = validUnit(i?.weightUnit);
        return {
          name: String(i?.name || '').trim(),
          weight: roundWeight(i?.weight, iUnit),
          weightUnit: iUnit,
          kcal: Math.round(Number(i?.kcal) || 0),
          protein: Math.round((Number(i?.protein) || 0) * 10) / 10,
          carbs:   Math.round((Number(i?.carbs)   || 0) * 10) / 10,
          fat:     Math.round((Number(i?.fat)      || 0) * 10) / 10,
        };
      }) : [];

      const kcal    = ingredients.reduce((s, i) => s + i.kcal, 0);
      const protein = Math.round(ingredients.reduce((s, i) => s + i.protein, 0) * 10) / 10;
      const carbs   = Math.round(ingredients.reduce((s, i) => s + i.carbs,   0) * 10) / 10;
      const fat     = Math.round(ingredients.reduce((s, i) => s + i.fat,     0) * 10) / 10;
      const weight  = ingredients.reduce((s, i) => s + i.weight, 0) || roundWeight(m?.weight, m?.weightUnit);
      const weightUnit = ingredients.length > 0 ? ingredients[0].weightUnit : validUnit(m?.weightUnit);

      return { name: String(m?.name || '').trim(), kcal, protein, carbs, fat, weight, weightUnit, ingredients };
    });

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

// ===== AI ANALYSIS UI =====

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

// ===== BUILD PROMPTS =====

function buildAiPrompt(description, weight) {
  const json = `{
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
  const hasPhotos = selectedPhotos.length > 0;
  let intro = hasPhotos
    ? 'Actuá como un nutricionista profesional con acceso a tablas nutricionales detalladas. Recibís una o más fotos — cada una puede ser una comida distinta O una etiqueta nutricional.'
    : 'Actuá como un nutricionista profesional con acceso a tablas nutricionales detalladas. El usuario describió una comida sin foto.';

  let parts = [];
  if (hasPhotos) parts.push('- Para cada foto de comida, identificá todos los ingredientes visibles y estimá su peso de forma REALISTA según lo que se ve en la imagen. Basate en proporciones visuales y recetas estándar.');
  if (description) parts.push(`- Descripción del usuario: "${description}". Prestá MUCHA atención a las cantidades, porciones y modificaciones que mencione.`);
  parts.push('- Si una foto es una etiqueta nutricional, usá esos valores exactos para el ingrediente correspondiente.');
  parts.push('- Calculá kcal y macros de cada ingrediente desde su peso × valores nutricionales por 100g.');
  parts.push('- El total de cada comida debe ser la suma EXACTA de sus ingredientes. Verificá antes de responder.');
  parts.push('- El objeto raíz (kcal/protein/carbs/fat) debe ser la suma EXACTA de todas las comidas.');

  let weightText = '';
  if (weight) {
    weightText = `\nEl usuario indica que la porción total pesa ${weight} gramos. Usá este dato como referencia para escalar los ingredientes.`;
  }

  return `${intro}
${weightText}

REGLAS IMPORTANTES:
${parts.map(p => '\n' + p).join('')}

REGLAS DE UNIDADES:
- Para cada ingrediente, usá la unidad adecuada: líquidos en ml o L, sólidos en g o kg.
- Ej: leche → 200 ml, agua → 250 ml, arroz → 150 g, pollo → 200 g, papa → 300 g, gaseosa → 350 ml.
- Si un peso supera los 1000 g, expresalo en kg (ej: 1.5 kg en vez de 1500 g).
- El campo "weightUnit" debe ser "ml", "L", "g" o "kg".

ATENCIÓN A PORCIONES:
- Si el usuario dice "la mitad", "medio plato", "poco", "chico", reducí los pesos a ~50% de una porción normal.
- Si dice "grande", "bien servido", "extra", aumentá los pesos a ~130-150% de una porción normal.
- Si dice "mediano", "normal", "estándar" usá la porción típica.
- Prestá MUCHA atención a calificativos de tamaño y cantidad. Una "manzana grande" no pesa lo mismo que una "manzana chica".
- Si menciona "2 tostadas", "3 galletitas", "medio plato" etc., usá exactamente esa cantidad.

Respondé SOLO con JSON válido siguiendo exactamente este esquema (reemplazá los 0 y textos de ejemplo con los valores reales):
${json}`;
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

// ===== PHOTO HANDLING =====

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

// ===== AI ANALYSIS FLOW =====

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

// ===== ADD FROM AI =====

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

// ===== RENDER MEALS (AI ingredient display) =====

function renderIngredients(ingredients) {
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
          ${ing.weight ? `<span class="ingredient-weight">${formatWeight(ing.weight, ing.weightUnit)}</span>` : ''}
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
