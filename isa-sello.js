/* isa-sello.js — Lectura incremental de la base del planificador usando el «sello de cambios».
 *
 * Qué es el sello: un documento (planificador_compartido/sello) con un token por categoría:
 *     { cats: { campos:'k3x9…', plan:'k3xa…', equipos:'…', geodata:'…', ejecucion:'…', labores:'…' }, actualizado, usuario }
 * El planificador cambia el token de una categoría SOLO cuando termina de guardar todas sus partes. Un módulo lector:
 *   1) lee el sello (1 documento),  2) compara con el que usó en su última lectura,  3) relee solo las categorías cuyo token cambió.
 * Si el sello no existe, no se puede leer o falta algún token, se hace la lectura completa de siempre (nunca se asume «sin cambios»).
 *
 * Este archivo NO modifica isa-conexion.js: lo extiende (ISA.sello, ISA.selloIgual, ISA.leerPlanInc). Cargar DESPUÉS de isa-conexion.js.
 */
(function (global) {
  'use strict';
  var ISA = global.ISA;
  if (!ISA) { if (global.console) console.warn('isa-sello.js: carga isa-conexion.js antes que este archivo.'); return; }

  var DOC_SELLO = 'sello';
  var CATS_PLAN = ['campos', 'plan', 'equipos', 'geodata'];   // las mismas que lee ISA.leerPlan

  function token(sello, cat) { return sello && sello.cats && typeof sello.cats[cat] === 'string' && sello.cats[cat] ? sello.cats[cat] : null; }

  /* Lee el sello. Devuelve el objeto o null si no existe todavía. Rechaza si no hay sesión. */
  function leerSello() {
    var s = ISA.sesion();
    if (!s || !s.user) return Promise.reject(new Error('Inicia sesión con tu usuario del planificador.'));
    return global.firebase.firestore().collection(ISA.COL).doc(DOC_SELLO).get()
      .then(function (d) { return d.exists ? (d.data() || {}) : null; });
  }

  /* ¿Las categorías `cats` tienen el mismo token en ambos sellos? Un token ausente cuenta como «no se sabe» => false. */
  function selloIgual(a, b, cats) {
    if (!a || !b) return false;
    return (cats || CATS_PLAN).every(function (c) { var x = token(a, c), y = token(b, c); return !!x && x === y; });
  }

  function clonar(o) { return typeof global.structuredClone === 'function' ? global.structuredClone(o) : JSON.parse(JSON.stringify(o)); }

  /* Igual que ISA.leerPlan, pero reutiliza de `opciones.cache` las categorías cuyo token no cambió.
     opciones = {
       sello:    sello leído ANTES de llamar (así, si algo cambia durante la lectura, el próximo ciclo lo detecta),
       cache:    objeto del llamador donde se conservan las categorías entre lecturas ({} para empezar),
       compartir: categorías que el llamador SOLO LEE y pueden entregarse por referencia sin copiar (p. ej. ['geodata'])
     }
     El resto se entrega como copia, para que el llamador pueda modificarlas sin dañar la caché. */
  function leerPlanInc(progreso, opciones) {
    opciones = opciones || {};
    var s = ISA.sesion();
    if (!s.user) return Promise.reject(new Error('Inicia sesión con tu usuario del planificador.'));
    if (!ISA.puedeLeer()) return Promise.reject(new Error('Tu usuario no tiene un rol asignado en el planificador. Pide a un administrador que te lo asigne.'));
    var sello = opciones.sello || null, cache = opciones.cache || {}, compartir = opciones.compartir || [];
    var avisa = function (t) { if (progreso) progreso(t); }, hechas = 0, reusadas = [], leidas = [];
    avisa('Leyendo la base del planificador…');
    function salida(cat, datos) { return compartir.indexOf(cat) >= 0 ? datos : clonar(datos); }
    return Promise.all(CATS_PLAN.map(function (cat) {
      var tok = token(sello, cat), c = cache[cat];
      if (tok && c && c.tok === tok) {
        reusadas.push(cat); hechas++;
        return { datos: salida(cat, c.datos), partes: c.partes };
      }
      return ISA.leerCategoria(cat).then(function (r) {
        leidas.push(cat); hechas++; avisa('Leyendo la base del planificador… (' + hechas + ' de ' + CATS_PLAN.length + ')');
        if (r && tok) { cache[cat] = { tok: tok, datos: r.datos, partes: r.partes }; return { datos: salida(cat, r.datos), partes: r.partes }; }
        if (r) delete cache[cat];   // sin token no se puede validar la caché de esta categoría
        return r;
      });
    })).then(function (rs) {
      var por = {}; CATS_PLAN.forEach(function (c, i) { por[c] = rs[i]; });
      if (!por.campos || !por.campos.datos.campos) throw new Error('No encontré los campos del planificador en la base.');
      if (!por.geodata || !por.geodata.datos.geoFeatures || !por.geodata.datos.geoFeatures.length) throw new Error('No encontré los polígonos de los lotes en la base (categoría geodata).');
      var d = Object.assign({}, por.equipos ? por.equipos.datos : {}, por.campos.datos, por.plan ? por.plan.datos : {}, por.geodata.datos);
      d.planItems = d.planItems || [];
      d._fuente = { origen: 'base', leidoEl: new Date().toISOString(), usuario: s.email, incremental: true, leidas: leidas, reusadas: reusadas,
        partes: CATS_PLAN.reduce(function (o, c) { o[c] = por[c] ? por[c].partes : 0; return o; }, {}) };
      return d;
    });
  }

  ISA.sello = leerSello; ISA.selloIgual = selloIgual; ISA.leerPlanInc = leerPlanInc; ISA.CATS_PLAN = CATS_PLAN;
})(typeof window !== 'undefined' ? window : globalThis);
