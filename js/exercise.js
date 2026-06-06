// ============================================================
// exercise.js — Módulo de ejercicios: CRUD, análisis con IA,
//               renderizado de página de ejercicios
// Dependencias: state.js, utils.js, nutrition.js
// ============================================================

// ===== EXERCISE CRUD =====

function addExercise(exercise) {
  const exercises = getExercises(currentDate);
  exercises.push({ ...exercise, id: Date.now(), type: selectedExerciseType });
  saveExercises(currentDate, exercises);
  renderExercisePage();
  renderHome();
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

// ===== AI EXERCISE ANALYSIS =====

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

// ===== EXERCISE MODAL =====

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

// ===== RENDER EXERCISE PAGE =====

function renderExercisePage() {
  const exercises = getExercises(currentDate);
  const totalBurned = exercises.reduce((s, e) => s + (e.kcalBurned || 0), 0);
  const totalFoods = getFoods(currentDate).reduce((s, f) => s + (f.kcal || 0), 0);
  const netBalance = totalFoods - currentProfile.goal + totalBurned;

  const ring = document.getElementById('exercise-ring-progress');
  if (ring) {
    const target = Math.max(300, currentProfile.goal * 0.2);
    const pct = Math.min(totalBurned / target, 1);
    const C = 2 * Math.PI * 40;
    ring.style.strokeDashoffset = C - pct * C;
  }

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

  renderExerciseWeekChart();
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
