# GLITCH LAB v0.2 — Prototipo incremental

App PWA de glitch art y efectos de cámara en tiempo real para iPhone 17 Pro.
Desarrollada íntegramente en Windows 11 (HTML/CSS/JavaScript + WebGL 2 + GLSL).
Instalable desde Safari como aplicación nativa (sin Mac, sin pagos obligatorios, sin reinstalación cada 7 días).

---

## 1. Qué es técnicamente

Se trata de una **Real-time GPU-accelerated camera effects app for iOS**, más específicamente:

- **Live Camera Processing**: procesamiento de imagen en directo desde `getUserMedia`.
- **GPU Shaders**: efectos calculados en el fragment shader (WebGL 2 / GLSL ES 3.00).
- **Metal Rendering Pipeline (indirecto)**: Safari/iOS traduce WebGL a Metal; el código no llama a Metal directamente.
- **Computational Photography**: acceso a la cámara y procesamiento avanzado de imagen en el cliente.
- **Non-destructive Camera Effects**: los efectos se aplican en el flujo de render; el archivo original de vídeo no se modifica.

Línea estética: herramienta de glitch art / distorsión digital al estilo SEG (@seg.cpu), con énfasis en control manual y interfaz tipo software VJ.

---

## 2. Estructura del proyecto

```
glitch-lab/
├── index.html                # Shell PWA + visor 9:16 + paneles de control
├── manifest.json             # Manifest de la PWA (instalable)
├── sw.js                     # Service Worker (caché para uso offline)
├── README.md                 # Este archivo
├── css/
│   └── style.css             # Interfaz técnica tipo software VJ
├── js/
│   ├── app.js                # Cámara, WebGL 2, bucle de render, análisis de luz,
│   │                         # grabación (MediaRecorder), presets (IndexedDB), UI
│   └── shaders.js            # Shaders GLSL ES 3.00 (vertex + fragment)
└── assets/
    ├── icon-192.svg
    └── icon-512.svg
```

---

## 3. Cómo ejecutarlo desde Windows 11

### Opción A: servidor local rápido (sin instalar nada)
```powershell
# En PowerShell, dentro de la carpeta glitch-lab
python -m http.server 8000
# o, si tienes Node.js:
npx serve .
```

Abre en el navegador de Windows: `http://localhost:8000`

### Opción B: abrir el archivo directamente
Doble clic en `index.html`.  
*Limitación*: la cámara y la grabación pueden requerir HTTPS en algunos navegadores; se recomienda usar el servidor local.

---

## 4. Cómo probarlo en el iPhone 17 Pro

La cámara y la grabación en iOS exigen **contexto seguro (HTTPS)**. Como desarrollas en Windows sin Mac, usa un túnel gratuito para exponer tu PC a internet:

1. Inicia el servidor local en Windows (`python -m http.server 8000` o `npx serve .`).
2. Expón el puerto con un túnel gratuito, por ejemplo:
   - **Cloudflare Tunnel** (gratis, sin cuenta de tarjeta): `cloudflared tunnel --url http://localhost:8000`
   - **ngrok** (plan gratuito): `ngrok http 8000`
3. El túnel te dará una URL tipo `https://xxxx.trycloudflare.com`.
4. Abre esa URL en Safari del iPhone (misma red WiFi no es necesaria; el túnel sale por internet).
5. Concede permiso de cámara cuando Safari lo pida.
6. Para instalar como app: en Safari pulsa **Compartir → A la pantalla de inicio**.

> **Nota honesta**: una PWA no se puede instalar desde HTTP en iOS. Sobre HTTP puedes probar el funcionamiento en el navegador de iPhone, pero para "A la pantalla de inicio" y acceso a cámara necesitas el túnel HTTPS o desplegar en un host gratuito con HTTPS (GitHub Pages, Netlify, Vercel, etc.).

---

## 5. Prueba concreta (paso a paso)

1. Abre la app en el iPhone (o en Windows para verificar el código).
2. Pulsa **Iniciar cámara** → concede permiso → verás el vídeo en vivo en el visor 9:16.
3. Mueve un objeto iluminado frente a la cámara: el panel **Aislamiento / Róscopia** lo separa del fondo oscuro usando el umbral de luminancia (cada objeto nuevo que entre se aísla).
4. Cambia la luz de la escena: observa cómo **Mosaicos según luz** varía el tamaño del bloque según la luminancia, y **Tracking por luz** sigue el punto más brillante según la sensibilidad.
5. Activa **Formas sensibles al movimiento** y mueve la cámara o el sujeto: aparece distorsión vectorial por diferencia de frames.
6. Prueba **Slide** (X/Y con suavizado), **Flicker** y **Umbral + ruido** para textura.
7. Pulsa **Grabar historia (9:16)**: se genera un WebM a 1080×1920 (escala 1:1) listo para Instagram Stories.
8. Guarda un preset con **Guardar preset** (IndexedDB) y cárgalo después para verificar persistencia.

---

## 6. ¿Qué está implementado y qué está pendiente?

### Implementado en este prototipo (v0.2)
- Shell PWA: manifest, service worker, metaetiquetas de Apple (`apple-mobile-web-app-capable`, `theme-color`, etc.).
- Cámara en vivo (`getUserMedia`, cámara trasera por defecto, cambio de cámara, selección de calidad 720p/1080p/4K ideal).
- Render WebGL 2 a pantalla completa con texto de cámara como entrada.
- Visor 9:16 optimizado para Historias de Instagram (1080×1920 con escala de render ajustable 1:1 / 3:4 / 1:2).
- **Aislamiento tipo róscopia por llave de luminancia** (umbral regulable, invertible, fondo limpio simulado).
- **Ruido/textura en el umbral** regulable a gusto.
- **Mosaicos no uniformes según la luz** (tamaño de bloque función de luminancia local + luminancia de escena).
- **Tracking por luz**: sigue el punto más brillante de la escena con suavizado regulable (sensibilidad).
- **Formas sensibles al movimiento**: distorsión vectorial basada en diferencia entre frames (motion diff).
- **Flicker** estocástico ligado a luz y movimiento.
- **Slide** (desplazamiento X/Y con suavizado/lerp).
- **Grabación** mediante `MediaRecorder` sobre `canvas.captureStream()` (WebM).
- **Presets** persistentes en IndexedDB (guardar/cargar/listar/eliminar).
- HUD con FPS, luminancia y resolución de render.
- Panel de estado técnico con limitaciones honestas.

### Pendiente (versiones futuras)
- Róscopia real con borrado de fondo mediante modelo de ML (MediaPipe Selfie Segmentation / TensorFlow.js) — requeriría descargar pesos del modelo; excluido intencionalmente en v0.2 por evitar dependencias externas y costos.
- Datamosh auténtico de compresión (manipulación de paquetes I/P/B de H.264/HEVC). Un shader que simula bloques **no es** datamosh de compresión real; por honesty no se incluye como tal.
- Efectos adicionales del roadmap original: RGB split (eliminado por petición del usuario), distorsión geométrica avanzada, VHS/ruido, shaders metálicos/líquidos, kaleidoscopio, distorsión por movimiento dedicada.
- Cadena de efectos configurable (reordenar efectos en la cadena).
- Exportación en ProRes / Apple Log / 4K 60 FPS (no posible vía PWA; ver limitaciones abajo).
- Iconos PNG reales para el manifest (actualmente SVG placeholders).

---

## 7. Limitaciones (con honestidad)

| Aspecto | Realidad en esta PWA |
|---------|----------------------|
| **Metal** | No hay acceso directo a Metal desde JavaScript. Safari usa WebGL como capa sobre Metal. |
| **ProRes / Apple Log** | No disponibles. `getUserMedia` en iOS entrega vídeo comprimido (típicamente H.264/HEVC). |
| **4K / 60 FPS con todos los efectos** | No garantizado. Depende del estado térmico del iPhone, del límite de texturas WebGL y de la carga del shader. Usa escala de render 0.5 si necesitas fluidez máxima. |
| **Datamosh de compresión** | No implementado. Los bloques que ves son generados por shader, no por manipulación real de códec. |
| **Cámara del iPhone 17 Pro a calidad nativa** | La web no expuesta el sensor completo de 48 MP ni los formatos profesionales de cámara. La calidad máxima práctica vía PWA es 1080p (ideal) o 4K ideal sujeto a lo que el navegador conceda. Para Historias de Instagram se renderiza a 1080×1920. |
| **Instalación en iPhone** | Requiere HTTPS. En Windows se prueba sobre HTTP, pero en el iPhone necesitas el túnel HTTPS o un hosting gratuito con HTTPS. |
| **Reinstalación cada 7 días** | No aplica: una PWA instalada no se reinstala cada 7 días (eso es un comportamiento de ciertas herramientas de firma gratuita de Xcode, no de PWA). |

---

## 8. Cómo se llamaría este proyecto

**Nombre comercial sugerido:** GLITCH LAB (o ROTOLAB si se enfatiza la róscopia).

**Clasificación técnica:** Real-time GPU-accelerated camera effects app for iOS — PWA de procesamiento de imagen en vivo con shaders, llave de luminancia, tracking por luz y grabación orientada a Historias de Instagram (9:16).

---

## 9. Próximo paso práctico

Este prototipo ya es funcional sobre WebGL 2. El siguiente paso de desarrollo sería añadir la cadena de efectos configurable (reordenar/activar-desactivar efectos) y el módulo de róscopia con modelo de ML ligero, siempre manteniendo la arquitectura PWA sin Mac y sin costos obligatorios.