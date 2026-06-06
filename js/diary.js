// ============================================================
// diary.js — CRUD de comidas, renderizado de páginas (home, stats, settings),
//            modal, y funcionalidad de comidas guardadas
// Dependencias: state.js, utils.js, nutrition.js, profile.js
// ============================================================

// ===== FOOD DIARY CRUD =====

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

  renderMiniWeek();
  renderSummaryBanner(totalKcal, goal, balance);
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

function renderCalendarHeatmap(profileId, goal, year, month) {
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const daysInMonth = lastDay.getDate();
  const startDow = firstDay.getDay();

  const monthNames = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
  const dayLabels = ['D','L','M','X','J','V','S'];

  let html = `<div class="calendar-header">
    <button class="calendar-nav-btn" onclick="changeCalendarMonth(-1)">&#8249;</button>
    <span class="calendar-month-label">${monthNames[month]} ${year}</span>
    <button class="calendar-nav-btn" onclick="changeCalendarMonth(1)">&#8250;</button>
  </div>
  <div class="calendar-heatmap">`;

  dayLabels.forEach(l => {
    html += `<div class="heatmap-weekday-label">${l}</div>`;
  });

  for (let i = 0; i < startDow; i++) {
    html += `<div></div>`;
  }

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

  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
  let monthTotal = 0, monthDays = 0, totalDeficit = 0;
  const tdee = currentProfile.tdee;
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

  document.querySelectorAll('.nav-item, .nav-link').forEach(el => {
    el.classList.toggle('active', el.dataset.page === page);
  });

  const fabEl = document.getElementById('fab');
  if (fabEl) fabEl.style.display = page === 'home' ? 'flex' : 'none';
  const exFabEl = document.getElementById('exercise-fab');
  if (exFabEl) exFabEl.style.display = page === 'exercise' ? 'flex' : 'none';

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
    addFood(food);
    closeModal();
    showToast(food.name + ' actualizado');
  } else if (editingFoodId !== null) {
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
