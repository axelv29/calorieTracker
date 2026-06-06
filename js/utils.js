// ============================================================
// utils.js — Funciones utilitarias puras (sin DOM complejo)
// Dependencias: state.js (para MEAL_LABELS, MEAL_ORDER)
// ============================================================

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

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

// Parsea JSON devuelto por la IA, limpiando markdown fences
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

// Modal de error para errores de API Gemini
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
