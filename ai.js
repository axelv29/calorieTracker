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

  const badge = document.getElementById('product-badge');
  if (foundProduct) {
    badge.style.display = 'flex';
    badge.innerHTML = `<span class="product-badge-icon">&#x1f50d;</span>
      <span><span class="product-badge-brand">${escHtml(foundProduct.brand)}</span> ${escHtml(foundProduct.name)}${foundProduct.quantity ? ' <span class="product-badge-sub">· ' + escHtml(foundProduct.quantity) + '</span>' : ''}</span>`;
  } else {
    badge.style.display = 'none';
  }

  document.getElementById('ai-result').style.display = 'block';
  document.getElementById('save-toggle').style.display = 'flex';
  document.getElementById('add-food-btn').style.display = 'block';
}

// ===== OPEN FOOD FACTS LOOKUP =====

let foundProduct = null;

async function searchOpenFoodFacts(query) {
  if (!query || query.length < 3) return null;
  try {
    const res = await fetch(
      `https://world.openfoodfacts.org/cgi/search.pl?search_terms=${encodeURIComponent(query)}&json=1&page_size=3&fields=product_name,brands,nutriments,serving_size,quantity`,
      { headers: { 'User-Agent': 'CalorieTracker/1.0 (webapp)' } }
    );
    if (!res.ok) return null;
    const data = await res.json();
    if (!data.products || data.products.length === 0) return null;

    const products = data.products
      .map(p => {
        const n = p.nutriments || {};
        const kcal = n['energy-kcal_100g'] || n['energy_100g'] || null;
        if (!kcal) return null;
        return {
          name: p.product_name || '',
          brand: p.brands || '',
          quantity: p.quantity || '',
          per100g: {
            kcal: Math.round(Number(kcal)),
            protein: Math.round((Number(n.proteins_100g) || 0) * 10) / 10,
            carbs: Math.round((Number(n.carbohydrates_100g) || 0) * 10) / 10,
            fat: Math.round((Number(n.fat_100g) || 0) * 10) / 10,
          }
        };
      })
      .filter(Boolean);

    return products.length > 0 ? products[0] : null;
  } catch (e) {
    console.warn('Open Food Facts search failed:', e);
    return null;
  }
}

// ===== BUILD PROMPTS =====

function buildAiPrompt(description, weight, exactProduct) {
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

  let productText = '';
  if (exactProduct) {
    const p = exactProduct;
    productText = `\n\nDATOS EXACTOS DE PRODUCTO REAL ENCONTRADO EN BASE DE DATOS:
Producto: "${p.name}" (${p.brand})${p.quantity ? ' · ' + p.quantity : ''}
Valores nutricionales REALES por 100g:
- Calorías: ${p.per100g.kcal} kcal
- Proteína: ${p.per100g.protein}g
- Carbohidratos: ${p.per100g.carbs}g
- Grasas: ${p.per100g.fat}g

IMPORTANTE: USÁ ESTOS VALORES EXACTOS para los ingredientes que correspondan a este producto. No uses estimaciones genéricas ni valores de tablas. Si la foto muestra este producto y el usuario indicó cantidades, calculá los macros multiplicando estos valores por el peso real de la porción.`;

    foundProduct = exactProduct;
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

SI EL USUARIO MENCIONÓ UNA MARCA O PRODUCTO ESPECÍFICO:
- Si más arriba se te dieron DATOS EXACTOS DE PRODUCTO REAL, usá ESOS valores obligatoriamente.
- Si NO se te dieron datos exactos pero el usuario mencionó una marca (Milka, Coca-Cola, Arcor, etc.), buscá EN TU CONOCIMIENTO los valores nutricionales de ESE producto específico. No uses genéricos ("galletita") si sabés los valores del producto de marca.
- Ej: si dice "Coca-Cola 355ml", usá los valores reales de Coca-Cola (42 kcal/355ml, 10.6g azúcar), no genérico "gaseosa".
- Ej: si dice "Milka galleta malteada", usá los valores de ese producto específico si los conocés.
${productText}
Respondé SOLO con JSON válido. El campo "reasoning" debe documentar tu análisis de los PASOS 1, 2 y 3. Los campos numéricos deben reflejar SOLO el resultado del PASO 4.
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

  foundProduct = null;
  let exactProduct = null;
  if (description) {
    startAiAnalysis('analyze-btn', 'Buscando producto en base de datos…');
    exactProduct = await searchOpenFoodFacts(description);
    if (exactProduct) {
      document.getElementById('loading-message').textContent = 'Producto encontrado. Analizando con datos exactos…';
      await new Promise(r => setTimeout(r, 400));
    }
  }

  const weight = document.getElementById('photo-weight').value;
  const prompt = buildAiPrompt(description, weight, exactProduct);

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

  let res, data;
  try {
    res = await fetch(
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
    data = await res.json();
  } catch (fetchErr) {
    finishAiAnalysis(buttonId);
    throw fetchErr;
  }

  if (!res.ok) {
    const msg = data?.error?.message || 'Error desconocido';
    console.error('Gemini error:', res.status, data);
    finishAiAnalysis(buttonId);
    showErrorModal('Error ' + res.status, msg);
    throw new Error(msg);
  }

  const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
  if (!text) {
    finishAiAnalysis(buttonId);
    throw new Error('Respuesta vacía de la API');
  }

  const parsed = parseAiJson(text);
  showAiFoodResult(parsed, fallbackWeight);
  finishAiAnalysis(buttonId);
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
