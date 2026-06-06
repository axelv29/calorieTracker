// ============================================================
// state.js — Variables globales + persistencia en localStorage + todayStr
// Dependencias: ninguna (todayStr se define acá porque se necesita al cargar)
// Expone: currentProfile, currentDate, selectedPhotos, todayStr, + get/set storage
// ============================================================

// ===== VARIABLES GLOBALES =====

function todayStr() {
  return new Date().toISOString().split('T')[0];
}

let currentProfile = null;
let currentDate = todayStr();
let selectedPhotos = [];
let aiParsedFood = null;
let aiCorrectionHistory = [];
let editingFoodId = null;
let selectedMealType = 'breakfast';

// Stats calendar state
let statsCalendarMonth = null;

// Exercise state
let selectedExerciseType = 'cardio';
let aiParsedExercise = null;

// Export/import state
let pendingImportData = null;

// Constantes de tipos de comida
const MEAL_LABELS = {
  breakfast: 'Desayuno',
  lunch: 'Almuerzo',
  snack: 'Merienda',
  dinner: 'Cena',
  other: 'Otros'
};
const MEAL_ORDER = ['breakfast', 'lunch', 'snack', 'dinner', 'other'];

// Constantes de tipos de ejercicio
const EXERCISE_TYPES = {
  cardio: 'Cardio',
  strength: 'Fuerza',
  hiit: 'HIIT',
  flexibility: 'Flexibilidad / yoga',
  sport: 'Deporte',
  other: 'Otro'
};

// ===== STORAGE HELPERS =====

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

// ===== FOOD DATA =====

function getFoodsKey(profileId, date) { return `nutre_foods_${profileId}_${date}`; }
function getFoods(date) { return getStorage(getFoodsKey(currentProfile.id, date)) || []; }
function saveFoods(date, foods) { setStorage(getFoodsKey(currentProfile.id, date), foods); }

// ===== EXERCISE DATA =====

function getExercisesKey(profileId, date) { return `nutre_exercises_${profileId}_${date}`; }
function getExercises(date) { return getStorage(getExercisesKey(currentProfile.id, date)) || []; }
function saveExercises(date, exercises) { setStorage(getExercisesKey(currentProfile.id, date), exercises); }
