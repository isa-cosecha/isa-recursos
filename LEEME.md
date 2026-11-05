# Cosecha ISA — sincronización, sello de cambios, barra estándar y portada

## Qué trae este paquete
| Archivo | Para qué |
|---|---|
| `index.html`, `seguimiento_cosecha.html`, `diseno_lotes.html`, `resumen_cosechadoras.html` | Ya parchados sobre los originales de tu proyecto. Reemplazan a los del repo. |
| `isa-sync.js` | Nuevo. Scheduler de sincronización manual/automática (configurable en index → Ajustes). |
| `isa-sello.js` | Nuevo. Lectura incremental con el sello de cambios (lo usa Diseño de lotes). |
| `isa-barra.css` | Nuevo. Barra superior estándar con botón «Inicio». |
| `isa-conexion.js` | **Sin cambios.** No lo toques. |
| `firestore/firestore.rules`, `firestore/REGLAS_FIRESTORE.md` | Propuesta de reglas + hallazgos + tabla de pruebas. |
| `herramientas/aplicar_sync.py` | Alternativa: aplica los mismos cambios sobre los HTML originales de tu repo (todo o nada por archivo, con .bak). |

## Orden de despliegue (importa)
1. **Reglas de Firestore**: agrega permiso para `planificador_compartido/sello` (ver `firestore/REGLAS_FIRESTORE.md`).
2. Sube a GitHub los 4 HTML + `isa-sync.js`, `isa-sello.js`, `isa-barra.css` (misma carpeta que `isa-conexion.js`).
3. Espera ~1 min a GitHub Pages y haz recarga forzada (Ctrl+F5). Si cambias algún `isa-*` después, sube `?v=2` a `?v=3` en los HTML.
4. Entra a index como admin o editor → Ajustes → **Publicar sello de cambios** (una vez). Desde entonces el planificador lo renueva solo en cada guardado.
5. Prueba: en Ajustes pon modo Automática cada 1 min; abre Seguimiento; la pastilla de la barra debe pasar a «Sin cambios · comprobado hh:mm».

Si el repo ya tiene cambios posteriores a los archivos de tu proyecto, NO copies los HTML encima: restaura los originales y usa
`python3 herramientas/aplicar_sync.py /ruta/al/repo --dry-run` y luego sin `--dry-run`.

## Qué cambió
- **Portada**: nuevo acceso «Resumen de Cosechadoras» (antes de Diseño de Lotes, porque el resumen alimenta al diseño).
- **Barra estándar** (Seguimiento, Resumen, Diseño): misma altura, color `#0D4934`, botón «Inicio» a `index.html`, título con el nombre de la portada
  y estado de sincronización. Diseño de lotes pierde el encabezado grande y pasa a la tipografía de sistema (se quita Barlow/Google Fonts);
  el color primario de Diseño y Resumen se alinea a `#0D4934`.
- **Resumen**: al pulsar «Inicio» avisa si hay zafras procesadas sin guardar.
- **Sello de cambios**: el planificador publica `planificador_compartido/sello` al terminar de guardar cada categoría.
  Los módulos releen solo lo que cambió; cada «lectura completa de seguridad» (30 min a 4 h, en Ajustes) releen todo.
  Sin sello (o sin permiso) todo sigue funcionando como antes.
- **Lecturas por ciclo** (medido con base simulada): Seguimiento 6 → 1 sin cambios (2 si cambia una categoría);
  Diseño: el plan y la geodata no se vuelven a bajar si no cambiaron, el registro compara versiones;
  Resumen: nada si las versiones no cambiaron, o solo las zafras modificadas.

## Pendiente conocido
- Diseño de lotes viene **desactivado** en la sincronización automática por defecto (baja polígonos); actívalo en la tarjeta si lo necesitas.
- Revisión visual de la barra no realizada en navegador (no hubo uno disponible al construir el paquete).
- Seguimiento sigue con su propia lectura de Firestore (no usa `isa-conexion.js`).
