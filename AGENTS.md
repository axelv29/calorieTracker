# Nutre — CalorieTracker

App web **vanilla** (sin frameworks, sin build system, sin package manager).  
Cliente 100 % frontend — toda la data vive en `localStorage`.  
Idioma: **español**.

## Stack

- HTML + CSS plano + JS vanilla (sin dependencias)
- Fuentes: Syne + Plus Jakarta Sans via Google Fonts (ya cargadas)
- IA: **Google Gemini API** (`gemini-2.5-flash-lite`) para análisis de fotos de comida
- Sin tests, sin linter, sin typechecker, sin CI

## Entender la app

- `index.html` — toda la estructura DOM (setup screen, app, modal)
- `style.css` — ~1317 líneas, diseño responsive, mobile-first con sidebar en desktop
- `app.js` — ~764 líneas, toda la lógica en un solo archivo
- No hay separación por módulos ni imports

## Arquitectura

- **Perfiles**: se guardan en `localStorage` key `nutre_profiles` (objeto `{id -> {...}}`)
- **Comidas**: key `nutre_foods_{profileId}_{YYYY-MM-DD}`
- **Perfil activo**: `localStorage` key `nutre_active_profile`
- La app calcula **TDEE** (Mifflin-St Jeor) y permite meta personalizada
- Las comidas pueden registrarse por: foto IA, entrada manual, o comidas guardadas

## Puntos clave para un agente

1. **No hay servidor ni backend** — todo corre abriendo `index.html` directo en el navegador
2. **No hay npm/node** — no ejecutar `npm install`, `npm run`, etc.
3. **API Key de Gemini** requerida para foto-IA, se guarda en localStorage del perfil, nunca viaja a servidor propio
4. **Los modelos de IA usados**: `gemini-2.5-flash-lite` (modelo gratuito)
5. **Prefijo de localStorage**: `nutre_*` — útil para debuggear con `localStorage` en DevTools
6. **Diseño responsive**: breakpoint a 900px (sidebar desktop vs bottom-nav mobile)
7. **Todo el JS es global** — funciones y estado global (`currentProfile`, `currentDate`, etc.)
8. **No hay CI, tests, ni comandos de verificación** — la validación es manual abriendo el HTML

## Convenciones del código

- `app.js` usa funciones globales con nombres descriptivos en inglés (renderHome, addFood, etc.)
- Comentarios típicos de secciones (`// ===== STATE =====`)
- No hay TypeScript ni tipos
- Las notificaciones usan `showToast()` (2.8s de duración)
- Errores de API Gemini se muestran con `showErrorModal()`
- Las imágenes se comprimen a 1024px máx, JPEG calidad 0.82, base64 antes de enviar a Gemini
- Prompt de IA pide JSON estricto sin markdown

## Para probar cambios

Simplemente abrir `index.html` en cualquier navegador moderno.
