/**
 * Menú de casa — backend (Code.gs)
 * Guarda recetas, planificación semanal y lista de la compra en una Google Sheet.
 *
 * Configuración necesaria antes de desplegar:
 *  1. Crea (o reutiliza) una Google Sheet vacía y copia su ID (el trozo largo de la URL).
 *  2. En el editor de Apps Script: Configuración del proyecto (⚙️) > Propiedades del script
 *     > Añadir propiedad de script: SPREADSHEET_ID = <el ID de tu Sheet>.
 *  3. Despliega como aplicación web (ver README.md).
 *
 * Las pestañas de la Sheet se crean solas la primera vez que se usan.
 */

var DIAS = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];

function doGet(e) {
  var action = e.parameter && e.parameter.action;
  if (!action) {
    // Sin ?action=... en la URL: sirve la vista HTML directa (útil para probar desde script.google.com)
    return HtmlService.createHtmlOutputFromFile('index.html')
      .setTitle('Menú de casa')
      .addMetaTag('viewport', 'width=device-width, initial-scale=1');
  }
  try {
    var result = routeAction_(action, e.parameter);
    return jsonOutput_(result);
  } catch (err) {
    return jsonOutput_({ error: String(err) });
  }
}

function doPost(e) {
  try {
    var body = JSON.parse(e.postData.contents);
    var result = routeAction_(body.action, body.payload || {});
    return jsonOutput_(result);
  } catch (err) {
    return jsonOutput_({ error: String(err) });
  }
}

function jsonOutput_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// Punto único que traduce una "acción" (nombre + parámetros) a la función real.
// Las funciones de negocio de abajo no cambian nada.
function routeAction_(action, p) {
  switch (action) {
    case 'getRecipes': return getRecipes();
    case 'saveRecipe': return saveRecipe(p.recipe);
    case 'deleteRecipeById': return deleteRecipeById(p.id);
    case 'getWeekPlan': return getWeekPlan(p.weekId);
    case 'setWeekPlanCell': return setWeekPlanCell(p.weekId, p.dia, p.meal, p.recipeId);
    case 'getShoppingExtras': return getShoppingExtras(p.weekId);
    case 'addShoppingExtra': return addShoppingExtra(p.weekId, p.item);
    case 'deleteShoppingExtra': return deleteShoppingExtra(p.weekId, p.extraId);
    case 'getShoppingChecked': return getShoppingChecked(p.weekId);
    case 'setShoppingChecked': return setShoppingChecked(p.weekId, p.itemKey, p.value);
    case 'clearShoppingChecked': return clearShoppingChecked(p.weekId);
    default: throw new Error('Acción desconocida: ' + action);
  }
}

// ---------- utilidades de hoja ----------

function getSS_() {
  var id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  if (!id) {
    throw new Error('Falta la propiedad de script SPREADSHEET_ID. Configúrala en Configuración del proyecto > Propiedades del script.');
  }
  return SpreadsheetApp.openById(id);
}

function getSheet_(name, headers) {
  var ss = getSS_();
  var sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.appendRow(headers);
    sh.setFrozenRows(1);
    if (headers[0] === 'weekId') {
      sh.getRange(2, 1, sh.getMaxRows() - 1, 1).setNumberFormat('@');
    }
  }
  return sh;
}

function sheetToObjects_(sh) {
  var values = sh.getDataRange().getValues();
  if (values.length < 2) return [];
  var headers = values[0];
  return values.slice(1)
    .filter(function (r) { return r.join('') !== ''; })
    .map(function (r) {
      var obj = {};
      headers.forEach(function (h, i) { obj[h] = r[i]; });
      return obj;
    });
}

function withLock_(fn) {
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

// Google Sheets a veces convierte automáticamente un texto tipo "2026-07-06"
// en una celda de tipo Fecha. Esta función deja el weekId siempre en el mismo
// formato de texto (yyyy-MM-dd), venga la celda como texto o como Fecha.
function normalizeWeekId_(value) {
  if (Object.prototype.toString.call(value) === '[object Date]') {
    return Utilities.formatDate(value, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }
  return String(value);
}

// ---------- RECETAS ----------
// Hoja "Recetas": id | nombre | tipo | ingredientesJSON

function getRecipes() {
  var sh = getSheet_('Recetas', ['id', 'nombre', 'tipo', 'ingredientesJSON']);
  return sheetToObjects_(sh).map(function (o) {
    var ingredients = [];
    try { ingredients = JSON.parse(o.ingredientesJSON || '[]'); } catch (e) {}
    return { id: String(o.id), name: o.nombre, meal: o.tipo, ingredients: ingredients };
  });
}

function saveRecipe(recipe) {
  return withLock_(function () {
    var sh = getSheet_('Recetas', ['id', 'nombre', 'tipo', 'ingredientesJSON']);
    var data = sh.getDataRange().getValues();
    var rowIndex = -1;
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][0]) === String(recipe.id)) { rowIndex = i + 1; break; }
    }
    var rowVals = [recipe.id, recipe.name, recipe.meal, JSON.stringify(recipe.ingredients || [])];
    if (rowIndex > -1) {
      sh.getRange(rowIndex, 1, 1, 4).setValues([rowVals]);
    } else {
      sh.appendRow(rowVals);
    }
    return true;
  });
}

function deleteRecipeById(id) {
  return withLock_(function () {
    var sh = getSheet_('Recetas', ['id', 'nombre', 'tipo', 'ingredientesJSON']);
    var data = sh.getDataRange().getValues();
    for (var i = data.length - 1; i >= 1; i--) {
      if (String(data[i][0]) === String(id)) sh.deleteRow(i + 1);
    }
    return true;
  });
}

// ---------- PLAN SEMANAL ----------
// Hoja "PlanSemanal": weekId | dia | comidaId | cenaId

function getWeekPlan(weekId) {
  var sh = getSheet_('PlanSemanal', ['weekId', 'dia', 'comidaId', 'cenaId']);
  var rows = sheetToObjects_(sh).filter(function (o) { return normalizeWeekId_(o.weekId) === String(weekId); });
  var plan = {};
  DIAS.forEach(function (d) { plan[d] = { comida: null, cena: null }; });
  rows.forEach(function (r) {
    if (plan[r.dia]) {
      plan[r.dia].comida = r.comidaId ? String(r.comidaId) : null;
      plan[r.dia].cena = r.cenaId ? String(r.cenaId) : null;
    }
  });
  return plan;
}

function setWeekPlanCell(weekId, dia, meal, recipeId) {
  return withLock_(function () {
    var sh = getSheet_('PlanSemanal', ['weekId', 'dia', 'comidaId', 'cenaId']);
    var data = sh.getDataRange().getValues();
    var rowIndex = -1;
    for (var i = 1; i < data.length; i++) {
      if (normalizeWeekId_(data[i][0]) === String(weekId) && data[i][1] === dia) { rowIndex = i + 1; break; }
    }
    if (rowIndex === -1) {
      var newRow = [weekId, dia, meal === 'comida' ? (recipeId || '') : '', meal === 'cena' ? (recipeId || '') : ''];
      sh.appendRow(newRow);
    } else {
      var col = meal === 'comida' ? 3 : 4;
      sh.getRange(rowIndex, col).setValue(recipeId || '');
    }
    return true;
  });
}

// ---------- LISTA: PRODUCTOS SUELTOS ----------
// Hoja "ListaExtra": weekId | id | nombre | cantidad | unidad | categoria

function getShoppingExtras(weekId) {
  var sh = getSheet_('ListaExtra', ['weekId', 'id', 'nombre', 'cantidad', 'unidad', 'categoria']);
  return sheetToObjects_(sh)
    .filter(function (o) { return normalizeWeekId_(o.weekId) === String(weekId); })
    .map(function (o) { return { id: String(o.id), name: o.nombre, qty: o.cantidad, unit: o.unidad, cat: o.categoria }; });
}

function addShoppingExtra(weekId, item) {
  return withLock_(function () {
    var sh = getSheet_('ListaExtra', ['weekId', 'id', 'nombre', 'cantidad', 'unidad', 'categoria']);
    sh.appendRow([weekId, item.id, item.name, item.qty || '', item.unit || '', item.cat || 'Otros']);
    return true;
  });
}

function deleteShoppingExtra(weekId, extraId) {
  return withLock_(function () {
    var sh = getSheet_('ListaExtra', ['weekId', 'id', 'nombre', 'cantidad', 'unidad', 'categoria']);
    var data = sh.getDataRange().getValues();
    for (var i = data.length - 1; i >= 1; i--) {
      if (normalizeWeekId_(data[i][0]) === String(weekId) && String(data[i][1]) === String(extraId)) sh.deleteRow(i + 1);
    }
    return true;
  });
}

// ---------- LISTA: MARCADOS ----------
// Hoja "ListaMarcados": weekId | itemKey | marcado

function getShoppingChecked(weekId) {
  var sh = getSheet_('ListaMarcados', ['weekId', 'itemKey', 'marcado']);
  var rows = sheetToObjects_(sh).filter(function (o) { return normalizeWeekId_(o.weekId) === String(weekId); });
  var map = {};
  rows.forEach(function (r) { map[r.itemKey] = (r.marcado === true || r.marcado === 'TRUE' || r.marcado === 'true'); });
  return map;
}

function setShoppingChecked(weekId, itemKey, value) {
  return withLock_(function () {
    var sh = getSheet_('ListaMarcados', ['weekId', 'itemKey', 'marcado']);
    var data = sh.getDataRange().getValues();
    var rowIndex = -1;
    for (var i = 1; i < data.length; i++) {
      if (normalizeWeekId_(data[i][0]) === String(weekId) && data[i][1] === itemKey) { rowIndex = i + 1; break; }
    }
    if (rowIndex === -1) {
      sh.appendRow([weekId, itemKey, value]);
    } else {
      sh.getRange(rowIndex, 3).setValue(value);
    }
    return true;
  });
}

function clearShoppingChecked(weekId) {
  return withLock_(function () {
    var sh = getSheet_('ListaMarcados', ['weekId', 'itemKey', 'marcado']);
    var data = sh.getDataRange().getValues();
    for (var i = data.length - 1; i >= 1; i--) {
      if (normalizeWeekId_(data[i][0]) === String(weekId)) sh.deleteRow(i + 1);
    }
    return true;
  });
}
