// ============================================================
// profile.js — Creación, edición, carga de perfiles + setup screen
// Dependencias: state.js, utils.js, nutrition.js
// ============================================================

// Guarda el perfil desde el formulario de setup
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

  const macroProtein = parseInt(document.getElementById('setup-macro-protein').value);
  const macroCarbs = parseInt(document.getElementById('setup-macro-carbs').value);
  const macroFat = parseInt(document.getElementById('setup-macro-fat').value);
  const customMacros = (!Number.isNaN(macroProtein) || !Number.isNaN(macroCarbs) || !Number.isNaN(macroFat))
    ? { protein: Number.isNaN(macroProtein) ? null : macroProtein,
        carbs: Number.isNaN(macroCarbs) ? null : macroCarbs,
        fat: Number.isNaN(macroFat) ? null : macroFat,
        buffer: getMacroBuffer('setup') }
    : undefined;

  profiles[id] = {
    id, name, age, sex, weight, height, activity,
    tdee,
    goalOffset,
    goal,
    apiKey: apiKey || (profiles[id] ? profiles[id].apiKey : ''),
    savedFoods: profiles[id] ? profiles[id].savedFoods : [],
    customMacros: profiles[id]?.customMacros || customMacros
  };

  saveProfiles(profiles);
  setActiveProfileId(id);
  loadApp();
}

// Carga la app con el perfil activo
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

// Muestra la pantalla de setup (nuevo perfil o switcher)
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

// Renderiza los chips de perfiles existentes en la pantalla de setup
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

  const cm = p.customMacros || {};
  const proteinEl = document.getElementById('setup-macro-protein');
  const carbsEl = document.getElementById('setup-macro-carbs');
  const fatEl = document.getElementById('setup-macro-fat');
  if (proteinEl) proteinEl.value = cm.protein != null ? cm.protein : '';
  if (carbsEl) carbsEl.value = cm.carbs != null ? cm.carbs : '';
  if (fatEl) fatEl.value = cm.fat != null ? cm.fat : '';
  const buffer = cm.buffer === 'fat' ? 'fat' : 'carbs';
  document.querySelectorAll('#setup-macro-buffer .macro-buffer-pill').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.buffer === buffer);
  });
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
  // Limpiar macros personalizadas
  ['setup-macro-protein','setup-macro-carbs','setup-macro-fat'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  document.querySelectorAll('#setup-macro-buffer .macro-buffer-pill').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.buffer === 'carbs');
  });
}

// Renderiza la info del perfil en la sidebar
function renderSidebar() {
  const p = currentProfile;
  const el = document.getElementById('sidebar-profile-name');
  const sub = document.getElementById('sidebar-profile-sub');
  const av = document.getElementById('sidebar-avatar');
  if (el) el.textContent = p.name;
  if (sub) sub.textContent = getGoalText(getGoalOffset(p)) + ' · ' + p.goal + ' kcal/día';
  if (av) av.textContent = p.name.charAt(0).toUpperCase();
}

function switchProfile() { showSetup(getActiveProfileId()); }

// Borra todos los datos del perfil activo
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
