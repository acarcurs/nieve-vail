# Nieve Vail

Mi alternativa personal a OpenSnow, solo para Vail: **https://acarcurs.github.io/nieve-vail/**

- **Hoy**: probabilidad de que abran los Back Bowls para una fecha, nieve que falta, condiciones y noticias.
- **Pronóstico Cumbre** (16 días): mezcla el pronóstico de Vail, el del NWS y 9 modelos (ECMWF, AIFS, GFS, HRRR, NBM, ICON, GEM, UKMO, JMA), corregidos con lo que de verdad nevó en temporadas pasadas; 103 escenarios de ensambles para el rango.
- **Mapa 3D**: relieve real con las pistas y telesillas abiertas (OpenStreetMap + reporte de Vail) y la última foto de Sentinel-2.
- **Cámaras** en vivo, **Satélite** con la nieve detectada en los Back Bowls y el frente, e **Historial** de temporadas.

## Cómo se actualiza

Todo corre solo en GitHub Actions:

| Flujo | Cuándo | Qué hace |
|---|---|---|
| `Actualizar datos` | cada 3 horas | baja Vail, SNOTEL, NWS, modelos, ensambles, pistas y Sentinel-2; calcula Cumbre; publica la página |
| `Entrenar Cumbre` | cada lunes | compara pronósticos archivados (2023 en adelante) con la nieve real y guarda `data/cumbre_model.json` |
| `Publicar página` | al cambiar el código | vuelve a publicar en GitHub Pages |

Se pueden correr a mano en la pestaña **Actions → Run workflow**. Si un día falla una fuente, las demás siguen y se conservan los datos anteriores (`data/status.json` dice qué falló).

## Datos y créditos

Vail Resorts (vía [ski-run-scraper](https://github.com/jacobschulman/ski-run-scraper)), NRCS SNOTEL #842, NWS, modelos y ensambles vía [Open-Meteo](https://open-meteo.com) (CC BY 4.0), © colaboradores de OpenStreetMap, AWS Terrain Tiles, Sentinel-2 de Copernicus (ESA) vía Element 84. Uso personal; Vail decide la apertura según patrulla y avalanchas.
