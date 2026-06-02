// ===== STATE =====
let currentProfile = null;
let currentDate = todayStr();
let photoBase64 = null;
let aiParsedFood = null;

function todayStr() {
  return new Date().toISOString().split('T')[0];
}

function getStorage(key) {
  try { return JSON.parse(localStorage.getItem(key)); } catch { return null; }
}

function setStorage(key, val) {
  localStorage.setItem(key, JSON.stringify(val));
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

function saveProfile() {
  const name = document.getElementById('setup-name').value.trim();
  const age = parseInt(document.getElementById('setup-age').value);
  const sex = document.getElementById('setup-sex').value;
  const weight = parseFloat(document.getElementById('setup-weight').value);
  const height = parseFloat(document.getElementById('setup-height').value);
  const activity = document.getElementById('setup-activity').value;
  const goalInput = document.getElementById('setup-goal').value;
  const apiKey = document.getElementById('setup-apikey').value.trim();

  if (!name || !age || !weight || !height) {
    showToast('Completá nombre, edad, peso y altura ✋');
    return;
  }

  const profiles = getProfiles();
  const existingId = getActiveProfileId();
  const id = (existingId && profiles[existingId] && profiles[existingId].name === name)
    ? existingId
    : 'profile_' + Date.now();

  const tdee = calcTDEE({ weight, height, age, sex, activity });

  profiles[id] = {
    id, name, age, sex, weight, height, activity,
    tdee,
    goal: goalInput ? parseInt(goalInput) : tdee,
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

  currentProfile = profiles[id];
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
}

function renderProfileSwitcher(profiles, activeId) {
  const container = document.getElementById('profiles-switcher');
  const keys = Object.keys(profiles);
  if (keys.length === 0) { container.innerHTML = ''; return; }
  container.innerHTML = keys.map(id =>
    `<button class="profile-chip ${id === activeId ? 'active' : ''}" onclick="selectSetupProfile('${id}')">${profiles[id].name}</button>`
  ).join('') + `<button class="profile-chip add-profile" onclick="clearSetupForm()">+ Nuevo</button>`;
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
  document.getElementById('setup-goal').value = p.goal !== p.tdee ? p.goal : '';
  document.getElementById('setup-apikey').value = p.apiKey || '';
}

function clearSetupForm() {
  ['setup-name','setup-age','setup-weight','setup-height','setup-goal','setup-apikey'].forEach(id => {
    document.getElementById(id).value = '';
  });
  document.getElementById('setup-sex').value = 'm';
  document.getElementById('setup-activity').value = '1.55';
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
  if (sub) sub.textContent = 'Meta: ' + p.goal + ' kcal/día';
  if (av) av.textContent = p.sex === 'f' ? '👩' : '👨';
}

// ===== FOOD DATA =====
function getFoodsKey(profileId, date) { return `nutre_foods_${profileId}_${date}`; }
function getFoods(date) { return getStorage(getFoodsKey(currentProfile.id, date)) || []; }
function saveFoods(date, foods) { setStorage(getFoodsKey(currentProfile.id, date), foods); }

function addFood(food) {
  const foods = getFoods(currentDate);
  foods.push({ ...food, id: Date.now() });
  saveFoods(currentDate, foods);
  renderHome();
}

function deleteFood(id) {
  const foods = getFoods(currentDate).filter(f => f.id !== id);
  saveFoods(currentDate, foods);
  renderHome();
}

// ===== RENDER HOME =====
function renderHome() {
  const foods = getFoods(currentDate);
  const totalKcal = foods.reduce((s, f) => s + (f.kcal || 0), 0);
  const totalProtein = foods.reduce((s, f) => s + (f.protein || 0), 0);
  const totalCarbs = foods.reduce((s, f) => s + (f.carbs || 0), 0);
  const totalFat = foods.reduce((s, f) => s + (f.fat || 0), 0);
  const goal = currentProfile.goal;
  const remaining = goal - totalKcal;
  const balance = totalKcal - goal;

  // Ring
  const pct = Math.min(totalKcal / goal, 1);
  const R = 40, C = 2 * Math.PI * R;
  const ring = document.getElementById('ring-progress');
  if (ring) {
    ring.style.strokeDashoffset = C - pct * C;
    ring.style.stroke = totalKcal > goal ? 'var(--orange)' : 'var(--green)';
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
  const maxMacro = Math.max(totalProtein, totalCarbs, totalFat, 1);
  setBar('bar-protein', totalProtein / maxMacro * 100);
  setBar('bar-carbs', totalCarbs / maxMacro * 100);
  setBar('bar-fat', totalFat / maxMacro * 100);
  setText('val-protein', Math.round(totalProtein) + 'g');
  setText('val-carbs', Math.round(totalCarbs) + 'g');
  setText('val-fat', Math.round(totalFat) + 'g');

  // Food list
  const list = document.getElementById('food-list');
  if (!list) return;

  if (foods.length === 0) {
    list.innerHTML = `<div class="empty-state">
      <div class="empty-icon">🍽️</div>
      <p>No hay comidas registradas hoy.<br>Tocá <strong>+ Agregar</strong> para empezar.</p>
    </div>`;
  } else {
    const emojis = ['🍽️','🥗','🍜','🥩','🍳','🥑','🍚','🫙','🥪','🍎','🥦','🍌','🫕','🥘','🍱'];
    list.innerHTML = foods.map((f, i) => `
      <div class="food-item">
        <div class="food-emoji">${emojis[i % emojis.length]}</div>
        <div class="food-info">
          <div class="food-name">${escHtml(f.name)}</div>
          <div class="food-meta">
            ${f.weight ? f.weight + 'g · ' : ''}P: ${Math.round(f.protein||0)}g · C: ${Math.round(f.carbs||0)}g · G: ${Math.round(f.fat||0)}g
          </div>
        </div>
        <span class="food-kcal">${f.kcal} kcal</span>
        <button class="food-delete" onclick="deleteFood(${f.id})">✕</button>
      </div>
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
    el.style.background = 'linear-gradient(135deg, var(--green) 0%, #38A169 100%)';
    el.querySelector('.banner-title').textContent = '¡Vas bien hoy! 🎉';
    el.querySelector('.banner-sub').textContent = `Todavía podés comer ${Math.abs(balance)} kcal más`;
    el.querySelector('.bval').textContent = Math.abs(balance);
    el.querySelector('.bsub').textContent = 'kcal restantes';
  } else {
    el.style.background = 'linear-gradient(135deg, var(--orange) 0%, #E06020 100%)';
    el.querySelector('.banner-title').textContent = 'Pasaste la meta 🔥';
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
  if (currentDate === today) label = 'Hoy ✨';
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
  setText('settings-name', p.name);
  const av = document.getElementById('settings-avatar');
  if (av) av.textContent = p.sex === 'f' ? '👩' : '👨';
  setText('settings-tdee', 'TDEE: ' + p.tdee + ' kcal · Meta: ' + p.goal + ' kcal');

  const actLabels = {'1.2':'Sedentario','1.375':'Ligero','1.55':'Moderado','1.725':'Activo','1.9':'Muy activo'};
  const rows = document.getElementById('settings-rows');
  if (rows) rows.innerHTML = `
    <div class="settings-row"><span>Peso</span><span>${p.weight} kg</span></div>
    <div class="settings-row"><span>Altura</span><span>${p.height} cm</span></div>
    <div class="settings-row"><span>Edad</span><span>${p.age} años</span></div>
    <div class="settings-row"><span>Actividad</span><span>${actLabels[p.activity] || p.activity}</span></div>
    <div class="settings-row"><span>API Key Gemini</span><span>${p.apiKey ? '✅ Configurada' : '❌ Sin configurar'}</span></div>
  `;

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
      <button class="food-delete" onclick="deleteSavedFood(${i})">✕</button>
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
function openModal() {
  resetModal();
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
  document.getElementById('add-photo-btn').style.display = 'none';
  document.getElementById('save-toggle').style.display = 'none';
  document.getElementById('loading-state').style.display = 'none';
  document.getElementById('analyze-btn').disabled = true;
  document.getElementById('photo-weight').value = '';
  document.getElementById('photo-context').value = '';
  document.getElementById('photo-input').value = '';
  photoBase64 = null;
  aiParsedFood = null;
  switchTab('photo');
}

function switchTab(tab) {
  ['photo','manual','saved'].forEach(t => {
    document.getElementById('tab-' + t).classList.toggle('active', t === tab);
  });
  document.querySelectorAll('.tab-btn').forEach((btn, i) => {
    btn.classList.toggle('active', ['photo','manual','saved'][i] === tab);
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
      document.getElementById('add-photo-btn').style.display = 'none';
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
  const weightText = weight ? ` La porción pesa ${weight} gramos.` : '';
  const contextText = context ? ` Contexto adicional del usuario: "${context}".` : '';

  document.getElementById('loading-state').style.display = 'block';
  document.getElementById('ai-result').style.display = 'none';
  document.getElementById('add-photo-btn').style.display = 'none';
  document.getElementById('analyze-btn').disabled = true;

  const prompt = `Analizá esta foto de comida y estimá las calorías y macronutrientes.${weightText}${contextText}
Respondé SOLO con un JSON válido, sin markdown ni texto extra, con este formato exacto:
{
  "name": "nombre descriptivo del plato",
  "kcal": número,
  "protein": número en gramos,
  "carbs": número en gramos,
  "fat": número en gramos,
  "weight": número en gramos o null,
  "note": "breve nota sobre la estimación"
}`;

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [
            { inline_data: { mime_type: 'image/jpeg', data: photoBase64 } },
            { text: prompt }
          ]}]
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
    const clean = text.replace(/```json|```/g, '').trim();
    aiParsedFood = JSON.parse(clean);

    if (weight && !aiParsedFood.weight) aiParsedFood.weight = parseInt(weight);

    document.getElementById('result-name').textContent = aiParsedFood.name;
    document.getElementById('res-kcal').textContent = aiParsedFood.kcal;
    document.getElementById('res-protein').textContent = Math.round(aiParsedFood.protein) + 'g';
    document.getElementById('res-carbs').textContent = Math.round(aiParsedFood.carbs) + 'g';
    document.getElementById('res-fat').textContent = Math.round(aiParsedFood.fat) + 'g';
    document.getElementById('res-note').textContent = aiParsedFood.note || '';

    document.getElementById('ai-result').style.display = 'block';
    document.getElementById('add-photo-btn').style.display = 'block';
    document.getElementById('save-toggle').style.display = 'flex';

  } catch (err) {
    if (err.message === 'Failed to fetch') {
      showToast('Sin conexión o API Key incorrecta');
    } else {
      showToast('Error: ' + err.message.slice(0, 60));
    }
  } finally {
    document.getElementById('loading-state').style.display = 'none';
    document.getElementById('analyze-btn').disabled = false;
  }
}

function addFoodFromPhoto() {
  if (!aiParsedFood) return;
  if (document.getElementById('save-to-library').checked) saveToLibrary(aiParsedFood);
  addFood(aiParsedFood);
  closeModal();
  showToast('✅ ' + aiParsedFood.name + ' agregado');
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

  if (document.getElementById('save-manual').checked) saveToLibrary(food);
  addFood(food);
  closeModal();
  showToast('✅ ' + food.name + ' agregado');
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
  addFood({ ...food });
  closeModal();
  showToast('✅ ' + food.name + ' agregado');
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
    <div style="background:#fff;border-radius:20px;padding:28px;max-width:420px;width:100%;box-shadow:0 8px 40px rgba(0,0,0,0.2);">
      <div style="font-family:'Syne',sans-serif;font-size:1.1rem;font-weight:800;margin-bottom:12px;color:var(--red);">${title}</div>
      <div style="font-size:12px;color:var(--ink);background:var(--bg);border-radius:10px;padding:12px;font-family:monospace;line-height:1.6;word-break:break-word;max-height:200px;overflow-y:auto;">${msg}</div>
      <button onclick="document.getElementById('error-modal').remove()" style="margin-top:16px;width:100%;padding:10px;background:var(--ink);color:#fff;border:none;border-radius:10px;font-family:'Syne',sans-serif;font-size:13px;font-weight:700;cursor:pointer;">Entendido</button>
    </div>`;
  document.body.appendChild(el);
}

// ===== INIT =====
window.addEventListener('load', () => {
  const id = getActiveProfileId();
  const profiles = getProfiles();
  if (id && profiles[id]) loadApp();
  else showSetup();
});
