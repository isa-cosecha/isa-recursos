/* isa-barra.js — Estado y avisos de la barra superior estándar (ver isa-barra.css).
 *   ISABarra.estado(texto, tipo, detalle)  texto en la barra (#isa-estado). tipo: '' | 'ld' (leyendo, punto pulsante) | 'err'. detalle = tooltip.
 *   ISABarra.actualizado(detalle)          «Actualizado dd/mm, hh:mm» (igual que Seguimiento).
 *   ISABarra.aviso(texto, tipo)            franja bajo la barra (#isa-aviso). tipo: 'warn' | 'bad' | 'info'. texto vacío/null = ocultar.
 * Todo se escribe con textContent (nunca HTML). Si falta el elemento, no hace nada. */
(function (g) {
  'use strict';
  function el(id) { return document.getElementById(id); }
  function fechaCorta(ts) { return new Date(ts).toLocaleString('es', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }); }
  function estado(texto, tipo, detalle) {
    var e = el('isa-estado'); if (!e) return;
    e.textContent = texto || ''; e.className = 'isa-estado' + (tipo ? ' ' + tipo : ''); e.title = detalle || texto || '';
  }
  function actualizado(detalle) { estado('Actualizado ' + fechaCorta(Date.now()), '', detalle); }
  function aviso(texto, tipo) {
    var a = el('isa-aviso'); if (!a) return;
    if (!texto) { a.hidden = true; a.textContent = ''; return; }
    a.className = 'isa-aviso ' + (tipo || 'warn'); a.textContent = texto; a.hidden = false;
  }
  g.ISABarra = { estado: estado, actualizado: actualizado, aviso: aviso, fechaCorta: fechaCorta };
})(window);
