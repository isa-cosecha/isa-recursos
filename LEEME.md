# Sincronización manual / automática — paquete para GitHub

## Opción A (recomendada): reemplazar archivos
Los 4 HTML de la raíz de este zip ya vienen parchados sobre las versiones que hay en tu proyecto:
`index.html`, `seguimiento_cosecha.html`, `diseno_lotes.html`, `resumen_cosechadoras.html`, más `isa-sync.js` (nuevo).
Cópialos a la raíz de tu repo (isa-conexion.js NO cambia), revisa con `git diff`, commit y push.
Si el repo tiene cambios más recientes que estos archivos, usa la opción B para no pisarlos.

## Opción B: parchear tu copia actual
    python3 herramientas/aplicar_sync.py /ruta/a/tu/repo --dry-run   # simula
    python3 herramientas/aplicar_sync.py /ruta/a/tu/repo             # aplica (crea .bak; todo o nada por archivo)
Es idempotente (salta archivos que ya traen isa-sync.js). Si un archivo sale `[!!] NO modificado`, queda intacto
y el mensaje indica qué ancla no encontró.

## Después de subir
- GitHub Pages tarda ~1 min. Recarga forzada (Ctrl+F5) la primera vez.
- Si cambias isa-sync.js, sube `?v=1` a `?v=2` en los 4 HTML (caché de Pages).
- index → Ajustes → «Sincronización de datos con la base»: modo, intervalo, módulos, «Sincronizar ahora».
- Configuración por navegador (localStorage del mismo origen). index sigue en tiempo real.
- «Diseño de lotes» viene DESACTIVADO por defecto en auto: cada lectura baja geodata (~12 MB). Actívalo a propósito.
- «Resumen de cosechadoras» en auto hace 1 sola lectura (meta) si ninguna versión cambió.
- Revertir: `git checkout -- .`
