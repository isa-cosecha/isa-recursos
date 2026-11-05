/* isa-sync.js — Sincronización manual / automática de la lectura de la base (Firestore).
 *
 * Reparto de responsabilidades:
 *   - Este archivo decide CUÁNDO leer (modo, intervalo, pausas, reintentos).
 *   - Cada módulo decide CÓMO leer: se registra con ISASync.registrar({ id, ejecutar, ... }).
 *
 * Configuración: UNA por navegador, en localStorage (mismo origen => la comparten index y los módulos;
 * el evento 'storage' reprograma los módulos ya abiertos sin recargar).
 *
 * Contrato de registrar(def):
 *   id         'seguimiento' | 'diseno' | 'resumen'   (clave en cfg.modulos)
 *   nombre     texto para mostrar
 *   ejecutar(ctx) función que lee la base. Puede ser async. Devolver false (o lanzar) = fallo => backoff.
 *              ctx = { auto: bool, completa: bool }. auto=true: disparo del reloj. completa=true: el módulo debe
 *              ignorar sellos/versiones y releer todo (lectura manual, o «barrido de seguridad» cada barridoMin).
 *   permitido() opcional. false => no hay sesión / datos cargados de archivo / etc. (se reintenta pronto)
 *   ocupado()   opcional. true  => el módulo está leyendo, guardando o procesando (se reintenta pronto)
 */
(function (global) {
  'use strict';

  var KEY = 'isa.sync.v1';
  var CANAL = 'isa-sync';
  var MIN_MIN = 1, MAX_MIN = 1440;      // intervalo permitido, en minutos
  var REINTENTO_MS = 15000;             // módulo ocupado / usuario escribiendo / sin permiso
  var ESPERA_TECLA_MS = 4000;           // no refrescar si el usuario tecleó hace menos de esto
  var MAX_BACKOFF_EXP = 3;              // tras fallos: x2, x4, x8 el intervalo (techo)

  var DEF = {
    modo: 'manual',                     // 'manual' | 'auto'
    intervaloMin: 10,
    barridoMin: 60,                     // cada cuánto se fuerza una lectura COMPLETA aunque el sello no haya cambiado
    pausarOculta: true,                 // no lee con la pestaña en segundo plano; al volver, lee si venció
    modulos: { seguimiento: true, diseno: false, resumen: true }   // diseno baja geodata (~12 MB): se activa a propósito
  };

  var mods = {}, timers = {}, escuchas = [], ultimaTecla = 0, canal = null;

  /* ───────── configuración ───────── */
  function normalizar(c) {
    var o = Object.assign({}, DEF, c || {});
    o.modo = o.modo === 'auto' ? 'auto' : 'manual';
    var n = parseFloat(o.intervaloMin);
    o.intervaloMin = isFinite(n) ? Math.min(MAX_MIN, Math.max(MIN_MIN, n)) : DEF.intervaloMin;
    var b = parseFloat(o.barridoMin);
    o.barridoMin = isFinite(b) ? Math.min(MAX_MIN, Math.max(5, b)) : DEF.barridoMin;
    o.pausarOculta = o.pausarOculta !== false;
    o.modulos = Object.assign({}, DEF.modulos, (c && c.modulos) || {});
    return o;
  }
  function get() {
    try { return normalizar(JSON.parse(localStorage.getItem(KEY) || 'null')); }
    catch (e) { return normalizar(null); }
  }
  function set(parcial) {
    var actual = get();
    var nuevo = normalizar(Object.assign({}, actual, parcial || {}, {
      modulos: Object.assign({}, actual.modulos, (parcial && parcial.modulos) || {})
    }));
    try { localStorage.setItem(KEY, JSON.stringify(nuevo)); } catch (e) { /* modo privado / cuota: queda solo en memoria de esta pestaña */ }
    reprogramarTodo(); notificar();
    return nuevo;
  }

  /* ───────── utilidades ───────── */
  function hora(ts) {
    return ts ? new Date(ts).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' }) : '–';
  }
  function fmtIntervalo(min) {
    if (min >= 60 && min % 60 === 0) return (min / 60) + ' h';
    return (Math.round(min * 10) / 10) + ' min';
  }
  function usuarioEscribiendo() {
    var a = document.activeElement;
    var editable = a && (a.tagName === 'TEXTAREA' || (a.tagName === 'INPUT' && /^(text|search|number|email|password|date|time|url|tel)?$/i.test(a.type || '')));
    return !!editable && (Date.now() - ultimaTecla) < ESPERA_TECLA_MS;
  }
  function notificar() { escuchas.forEach(function (f) { try { f(); } catch (e) { /* un listener roto no debe frenar al resto */ } }); }
  function activo(id, c) { c = c || get(); return c.modo === 'auto' && c.modulos[id] !== false; }

  /* ───────── planificador ───────── */
  function programar(id, ms) {
    var m = mods[id]; if (!m) return;
    clearTimeout(timers[id]);
    m.proxima = Date.now() + ms;
    timers[id] = setTimeout(function () { tick(id, false); }, ms);
  }
  function reprogramar(id) {
    var m = mods[id]; if (!m) return;
    var c = get();
    clearTimeout(timers[id]); timers[id] = null;
    if (!activo(id, c)) { m.proxima = 0; m.pendiente = false; if (!m.ejecutando) m.estado = 'manual'; return; }
    var base = c.intervaloMin * 60000;
    var espera = base * Math.pow(2, Math.min(m.fallos, MAX_BACKOFF_EXP));
    // se cuenta desde el último intento: cambiar el intervalo respeta el tiempo ya transcurrido
    programar(id, Math.max(1000, m.ultimoIntento + espera - Date.now()));
    if (!m.ejecutando && m.estado !== 'error') m.estado = 'auto';
  }
  function reprogramarTodo() { Object.keys(mods).forEach(reprogramar); }

  async function tick(id, forzar) {
    var m = mods[id]; if (!m || m.ejecutando) return false;
    var c = get();
    if (!forzar) {
      if (!activo(id, c)) { m.pendiente = false; return false; }
      if ((c.pausarOculta && document.hidden) || navigator.onLine === false) { m.pendiente = true; m.estado = 'en espera'; notificar(); return false; }
      var bloqueado = false;
      try { bloqueado = (m.permitido && !m.permitido()) || (m.ocupado && m.ocupado()) || usuarioEscribiendo(); } catch (e) { bloqueado = true; }
      if (bloqueado) { programar(id, REINTENTO_MS); notificar(); return false; }
    } else {
      try { if (m.ocupado && m.ocupado()) return false; } catch (e) { return false; }
    }
    var ctx = { auto: !forzar, completa: !!forzar || (Date.now() - m.ultimaCompleta) >= c.barridoMin * 60000 };
    m.ejecutando = true; m.ultimoIntento = Date.now(); m.estado = 'sincronizando'; notificar();
    var ok = false;
    try { ok = (await m.ejecutar(ctx)) !== false; }
    catch (e) { ok = false; m.error = e && e.message ? e.message : String(e); }
    m.ejecutando = false;
    if (ok) { m.ultima = Date.now(); if (ctx.completa) m.ultimaCompleta = m.ultima; m.fallos = 0; m.estado = 'ok'; m.error = ''; }
    else { m.fallos++; m.estado = 'error'; }
    reprogramar(id); notificar();
    return ok;
  }

  /* ───────── API pública ───────── */
  function registrar(def) {
    if (!def || !def.id || typeof def.ejecutar !== 'function') throw new Error('ISASync.registrar: se requiere id y ejecutar().');
    mods[def.id] = {
      id: def.id, nombre: def.nombre || def.id, ejecutar: def.ejecutar, permitido: def.permitido, ocupado: def.ocupado,
      ultima: 0, ultimaCompleta: 0, ultimoIntento: Date.now(), proxima: 0, fallos: 0, estado: 'inactivo', ejecutando: false, pendiente: false, error: ''
    };
    reprogramar(def.id); notificar();
  }
  /* Para que una lectura manual (botón del propio módulo) reinicie el reloj y actualice «última sincronización». */
  function marcar(id, ok, completa) {   // completa=true: fue una lectura completa (reinicia el reloj del barrido de seguridad)
    var m = mods[id]; if (!m) return;
    m.ultimoIntento = Date.now();
    if (ok === false) { m.fallos++; m.estado = 'error'; } else { m.ultima = Date.now(); if (completa) m.ultimaCompleta = m.ultima; m.fallos = 0; m.estado = 'ok'; }
    reprogramar(id); notificar();
  }
  function ahora(id) {
    if (id) return tick(id, true);
    return Promise.all(Object.keys(mods).map(function (k) { return tick(k, true); }));
  }
  /* Ordena sincronizar a TODOS los módulos abiertos en este navegador (otras pestañas incluidas). */
  function ahoraTodos() {
    try { if (canal) canal.postMessage({ cmd: 'ahora' }); } catch (e) { /* sin BroadcastChannel: solo esta pestaña */ }
    return ahora();
  }
  function alCambiar(fn) { if (typeof fn === 'function') escuchas.push(fn); }
  function etiqueta(id) {
    var m = mods[id]; if (!m) return '';
    if (m.ejecutando) return 'Sincronizando…';
    var c = get(), ult = m.ultima ? 'últ. ' + hora(m.ultima) : 'sin sincronizar';
    if (!activo(id, c)) return 'Sync manual · ' + ult;
    var s = 'Auto cada ' + fmtIntervalo(c.intervaloMin) + ' · ' + ult + (m.proxima ? ' · próx. ' + hora(m.proxima) : '');
    return m.estado === 'error' ? s + ' · ⚠ falló, reintenta' : s;
  }
  /* Muestra el estado en un elemento (id o nodo). Sin destino: pastilla fija abajo a la derecha. */
  function montarChip(id, destino) {
    if (!document.body) { document.addEventListener('DOMContentLoaded', function () { montarChip(id, destino); }); return; }   // script cargado en <head>
    var el = typeof destino === 'string' ? document.getElementById(destino) : destino;
    if (!el) {
      el = document.createElement('div');
      el.style.cssText = 'position:fixed;right:10px;bottom:8px;z-index:9999;font:11px/1.4 system-ui,sans-serif;padding:3px 9px;border-radius:10px;background:rgba(127,127,127,.18);pointer-events:none';
      document.body.appendChild(el);
    }
    var pintar = function () { el.textContent = etiqueta(id); el.title = (mods[id] && mods[id].error) || ''; };
    escuchas.push(pintar); pintar();
  }

  /* ───────── eventos globales ───────── */
  function reanudar() {
    if (document.hidden) return;
    Object.keys(mods).forEach(function (id) { if (mods[id].pendiente) { mods[id].pendiente = false; tick(id, false); } });
  }
  document.addEventListener('visibilitychange', reanudar);
  global.addEventListener('online', reanudar);
  document.addEventListener('keydown', function () { ultimaTecla = Date.now(); }, true);
  global.addEventListener('storage', function (e) { if (e.key === KEY) { reprogramarTodo(); notificar(); } });
  try {
    if (global.BroadcastChannel) {
      canal = new BroadcastChannel(CANAL);
      canal.onmessage = function (e) { if (e.data && e.data.cmd === 'ahora') ahora(); };
    }
  } catch (e) { canal = null; }

  global.ISASync = { get: get, set: set, registrar: registrar, marcar: marcar, ahora: ahora, ahoraTodos: ahoraTodos, alCambiar: alCambiar, etiqueta: etiqueta, montarChip: montarChip, MIN_MIN: MIN_MIN, MAX_MIN: MAX_MIN };
})(typeof window !== 'undefined' ? window : globalThis);
