# Menú de casa — GitHub Pages + Google Sheets

La app se sirve desde una URL de GitHub Pages, pero los datos (recetas, planificación, lista de la compra) siguen viviendo en tu Google Sheet, igual que antes.

## Cómo funciona ahora

Antes, `Index.html` hablaba con `Code.gs` usando `google.script.run`, que **solo existe cuando la página se abre desde `script.google.com`**. Ahora `Code.gs` actúa además como una pequeña API (recibe peticiones HTTP normales) y `index.html`/`Index.html` le habla por `fetch()`, que sí funciona desde cualquier dominio, incluido GitHub Pages.

- `Code.gs` — mismas funciones de siempre (`getRecipes`, `saveRecipe`, etc.) + un enrutador (`doGet`/`doPost`) que las expone como API.
- `index.html` (minúsculas) — la app completa. La sirve GitHub Pages, y también Apps Script si abres la URL `.../exec` directamente sin `?action=` (útil para probar). GitHub Pages es sensible a mayúsculas/minúsculas y solo reconoce `index.html` como página de inicio, así que solo hay un archivo — nada que mantener sincronizado.
- `appsscript.json` — el acceso ahora es **`ANYONE`** (antes estaba en `MYSELF`). Es imprescindible: si lo dejas en `MYSELF`, GitHub Pages no podrá llamar a la API porque solo tú (con tu sesión de Google) tendrías permiso.

## 1. Desplegar Code.gs como API (igual que antes, con un ajuste)

```bash
clasp push
```

En script.google.com: **Implementar → Gestionar implementaciones → ✎ → Nueva versión → Implementar**.

Al desplegar, revisa estas dos opciones (o vuelve a crear la implementación si ya existía con otras):
- Ejecutar como: **Yo**
- Quién tiene acceso: **Cualquier persona**

⚠️ "Cualquier persona" significa que cualquiera con la URL `.../exec` puede llamar a tu API y leer/escribir en la Sheet — no hay contraseña. La URL es larga y no adivinable, así que es razonablemente privada, pero no es una autenticación real. Si esto te preocupa, dímelo y añadimos una clave simple (un token en la URL que Code.gs valide) antes de compartir la URL de GitHub Pages con nadie fuera de casa.

Copia la URL `.../exec` que te da el diálogo.

## 2. Configurar la URL de la API en el frontend

Abre **`index.html`** y busca esta línea, cerca del principio del `<script>`:

```js
const API_URL = 'PEGA_AQUI_TU_URL_DE_EXEC';
```

Sustitúyela por tu URL real:

```js
const API_URL = 'https://script.google.com/macros/s/AKfycb.../exec';
```

Guarda. (Si más adelante rehaces el despliegue y te da una URL distinta, este es el único sitio que hay que tocar.)

## 3. Subir a GitHub y activar Pages

```bash
git add .
git commit -m "Frontend servido desde GitHub Pages, backend API en Apps Script"
git push
```

En el repositorio: **Settings → Pages → Source: Deploy from a branch → Branch: main / (root)**.

En 1-2 minutos tendrás tu URL, del tipo:
`https://TU-USUARIO.github.io/TU-REPO/`

Esa es la URL para el día a día. `index.html` en la raíz se sirve automáticamente.

## Notas

- Los dos adultos comparten los mismos datos (misma Sheet), abran la app desde donde la abran.
- Si `index.html` en GitHub Pages muestra "No se ha podido conectar con la hoja de cálculo" con un mensaje de red/CORS, casi siempre es una de estas dos causas: (a) `API_URL` no está bien pegada, o (b) el despliegue de Apps Script no tiene el acceso en "Cualquier persona".
