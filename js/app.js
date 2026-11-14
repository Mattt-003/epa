/* ========================================================================
   GLITCH LAB v0.2 — Prototipo funcional incremental
   Real-time GPU-accelerated camera effects app para iOS (PWA).
   Desarrollado en Windows 11 · HTML/CSS/JS + WebGL 2 + GLSL.
   ======================================================================== */

(function () {
  'use strict';

  // ------------------------------------------------------------------
  // Estado de la aplicación
  // ------------------------------------------------------------------
  const state = {
    started: false,
    facing: 'environment', // 'environment' = trasera, 'user' = selfie
    quality: '1080',       // 720 | 1080 | 2160 (ideal)
    renderScale: 0.75,     // 1 | 0.75 | 0.5
    stream: null,
    videoW: 0,
    videoH: 0,

    // Efectos (GLSL uniforms)
    threshold: 0.55,
    noiseAmt: 0.18,
    invert: false,
    mosaic: 0.45,
    mosaicSens: 0.70,      // se lee en UI; el shader usa u_luma + u_mosaic
    trackSens: 0.50,
    shapeMotion: 0.65,
    flicker: 0.30,
    slideX: 0.0,
    slideY: 0.0,
    slideSmooth: 0.50,
    slideTargetX: 0.0,
    slideTargetY: 0.0,

    // Análisis de luz (CPU, frame a frame)
    luma: 0.5,             // luminancia promedio escena 0-1
    trackX: 0.5,
    trackY: 0.5,

    // Render / métricas
    lastTime: 0,
    fps: 0,
    recording: false,
    mediaRecorder: null,
    recordedChunks: [],

    // GL handles
    gl: null,
    prog: null,
    texCurrent: null,
    texPrev: null,
    texNoise: null,
    loc: {}
  };

  // ------------------------------------------------------------------
  // Referencias del DOM
  // ------------------------------------------------------------------
  const $ = (id) => document.getElementById(id);
  const canvas = $('glCanvas');
  const video = $('cameraVideo');
  const gl = canvas.getContext('webgl2', {
    alpha: false,
    depth: false,
    stencil: false,
    antialias: false,
    premultipliedAlpha: false
  });

  const hudFps = $('hudFps');
  const hudLuma = $('hudLuma');
  const hudRes = $('hudRes');
  const hudRec = $('hudRec');
  const statusList = $('statusList');

  // ------------------------------------------------------------------
  // Honestidad técnica: estado de capacidades
  // ------------------------------------------------------------------
  function initStatusPanel() {
    const items = [];
    items.push(gl ? 'WebGL 2: disponible (GPU)' : 'WebGL 2: NO disponible — la app no funcionará');
    items.push('Cámara: getUserMedia (iOS entrega video comprimido H.264/HEVC; no ProRes ni Apple Log vía PWA)');
    items.push('Metal: acceso indirecto vía WebGL (Safari/iOS), no directo desde JS');
    items.push('4K / 60 FPS con todos los efectos: no garantizado; depende del estado térmico del iPhone');
    items.push('Datamosh auténtico de compresión: NO implementado (un shader no es datamosh de compresión real)');
    items.push('Róscopia real con ML (borrado de fondo): NO incluida; este prototipo usa llave de luminancia (luma key)');
    items.push('Instalación PWA en iPhone: requiere HTTPS; en este prototipo se prueba sobre HTTP en PC');
    statusList.innerHTML = items.map((t) => `<li>${t}</li>`).join('');
  }
  initStatusPanel();

  // ------------------------------------------------------------------
  // Utilidades de WebGL 2
  // ------------------------------------------------------------------
  function compileShader(type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      console.error('Shader compile error:', gl.getShaderInfoLog(shader));
      gl.deleteShader(shader);
      return null;
    }
    return shader;
  }

  function createProgram(vsSource, fsSource) {
    const vs = compileShader(gl.VERTEX_SHADER, vsSource);
    const fs = compileShader(gl.FRAGMENT_SHADER, fsSource);
    const prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      console.error('Program link error:', gl.getProgramInfoLog(prog));
      return null;
    }
    return prog;
  }

  function createTexture(width, height) {
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    return tex;
  }

  function generateNoiseTexture() {
    const size = 256;
    const data = new Uint8Array(size * size * 4);
    for (let i = 0; i < data.length; i += 4) {
      const v = Math.random() * 255;
      data[i] = v; data[i + 1] = v; data[i + 2] = v; data[i + 3] = 255;
    }
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, size, size, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
    return tex;
  }

  // ------------------------------------------------------------------
  // Inicialización de cámara (getUserMedia)
  // ------------------------------------------------------------------
  const qualityMap = {
    '720': { w: 1280, h: 720 },
    '1080': { w: 1920, h: 1080 },
    '2160': { w: 3840, h: 2160 }
  };

  async function initCamera() {
    const q = qualityMap[state.quality] || qualityMap['1080'];
    const constraints = {
      video: {
        facingMode: state.facing,
        width: { ideal: q.w, max: q.w },
        height: { ideal: q.h, max: q.h },
        frameRate: { ideal: 30, max: 60 }
      },
      audio: false
    };

    try {
      state.stream = await navigator.mediaDevices.getUserMedia(constraints);
      video.srcObject = state.stream;
      await video.play();
      // iOS a veces reporta 0 hasta que hay metadatos
      video.onloadedmetadata = () => {
        state.videoW = video.videoWidth || q.w;
        state.videoH = video.videoHeight || q.h;
        resizeCanvas();
        updateResHud();
      };
      $('btnStart').textContent = 'Cámara activa';
      $('btnStart').classList.add('btn-primary');
      $('btnStart').disabled = true;
      state.started = true;
      state.lastTime = performance.now();
      cancelAnimationFrame(state.raf);
      state.raf = requestAnimationFrame(loop);
    } catch (err) {
      console.error('Error de cámara:', err);
      alert('No se pudo acceder a la cámara. Asegúrate de estar en HTTPS (iOS) y de conceder el permiso.');
    }
  }

  $('btnToggleCam').addEventListener('click', async () => {
    state.facing = state.facing === 'environment' ? 'user' : 'environment';
    if (state.stream) {
      state.stream.getTracks().forEach((t) => t.stop());
    }
    state.started = false;
    $('btnStart').textContent = 'Iniciar cámara';
    $('btnStart').classList.remove('btn-primary');
    $('btnStart').disabled = false;
    await initCamera();
  });

  // ------------------------------------------------------------------
  // Tamaño del lienzo de render (historia IG 9:16)
  // ------------------------------------------------------------------
  const STORY_W = 1080;
  const STORY_H = 1920;

  function resizeCanvas() {
    const scale = parseFloat($('selRenderScale').value);
    state.renderScale = scale;
    canvas.width = Math.round(STORY_W * scale);
    canvas.height = Math.round(STORY_H * scale);
    updateResHud();
    if (gl) {
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
    }
  }

  $('selQuality').addEventListener('change', (e) => {
    state.quality = e.target.value;
    if (state.started) {
      if (state.stream) state.stream.getTracks().forEach((t) => t.stop());
      state.started = false;
      $('btnStart').textContent = 'Iniciar cámara';
      $('btnStart').classList.remove('btn-primary');
      $('btnStart').disabled = false;
    }
  });

  $('selRenderScale').addEventListener('change', resizeCanvas);

  function updateResHud() {
    hudRes.textContent = `${canvas.width}×${canvas.height}`;
  }

  // ------------------------------------------------------------------
  // Inicialización WebGL
  // ------------------------------------------------------------------
  function initGL() {
    if (!gl) {
      alert('Este navegador no soporta WebGL 2.');
      return false;
    }

    state.prog = createProgram(SHADERS.vertex, SHADERS.fragment);
    if (!state.prog) return false;

    gl.useProgram(state.prog);

    // Buffer de pantalla completa (triángulo strip)
    const posBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
      -1, -1,  1, -1, -1,  1,  1,  1
    ]), gl.STATIC_DRAW);
    const locPos = gl.getAttribLocation(state.prog, 'a_position');
    gl.enableVertexAttribArray(locPos);
    gl.vertexAttribPointer(locPos, 2, gl.FLOAT, false, 0, 0);

    const tcBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, tcBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
      0, 1,  1, 1,  0, 0,  1, 0
    ]), gl.STATIC_DRAW);
    const locTc = gl.getAttribLocation(state.prog, 'a_texCoord');
    gl.enableVertexAttribArray(locTc);
    gl.vertexAttribPointer(locTc, 2, gl.FLOAT, false, 0, 0);

    // Texturas
    state.texCurrent = createTexture(canvas.width, canvas.height);
    state.texPrev = createTexture(canvas.width, canvas.height);
    state.texNoise = generateNoiseTexture();

    // Locaciones de uniformes
    const L = state.loc;
    L.sampler = gl.getUniformLocation(state.prog, 'u_sampler');
    L.prev = gl.getUniformLocation(state.prog, 'u_prev');
    L.noise = gl.getUniformLocation(state.prog, 'u_noise');
    L.resolution = gl.getUniformLocation(state.prog, 'u_resolution');
    L.uvScale = gl.getUniformLocation(state.prog, 'u_uvScale');
    L.uvOffset = gl.getUniformLocation(state.prog, 'u_uvOffset');
    L.slide = gl.getUniformLocation(state.prog, 'u_slide');
    L.time = gl.getUniformLocation(state.prog, 'u_time');
    L.luma = gl.getUniformLocation(state.prog, 'u_luma');
    L.threshold = gl.getUniformLocation(state.prog, 'u_threshold');
    L.noiseAmt = gl.getUniformLocation(state.prog, 'u_noiseAmt');
    L.mosaic = gl.getUniformLocation(state.prog, 'u_mosaic');
    L.trackSens = gl.getUniformLocation(state.prog, 'u_trackSens');
    L.shapeMotion = gl.getUniformLocation(state.prog, 'u_shapeMotion');
    L.flicker = gl.getUniformLocation(state.prog, 'u_flicker');
    L.trackPos = gl.getUniformLocation(state.prog, 'u_trackPos');
    L.invert = gl.getUniformLocation(state.prog, 'u_invert');

    gl.disable(gl.BLEND);
    return true;
  }

  // ------------------------------------------------------------------
  // Análisis de luz por frame (CPU, canvas pequeño 64×64)
  // Proporciona luminancia promedio y centroide del punto más brillante.
  // ------------------------------------------------------------------
  const analysisCanvas = document.createElement('canvas');
  analysisCanvas.width = 64;
  analysisCanvas.height = 64;
  const analysisCtx = analysisCanvas.getContext('2d', { willReadFrequently: true });

  function analyzeFrame() {
    analysisCtx.drawImage(video, 0, 0, 64, 64);
    const data = analysisCtx.getImageData(0, 0, 64, 64).data;
    const len = data.length / 4;

    let sumLuma = 0;
    let wx = 0, wy = 0, wsum = 0;

    for (let i = 0; i < data.length; i += 4) {
      const l = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      sumLuma += l;
      if (l > 140) {
        const cx = (i / 4) % 64;
        const cy = Math.floor((i / 4) / 64);
        wx += cx * l;
        wy += cy * l;
        wsum += l;
      }
    }

    state.luma = sumLuma / (len * 255);

    if (wsum > 0) {
      const tx = wx / wsum / 64;
      const ty = wy / wsum / 64;
      const s = state.trackSens;
      // Suavizado (lerp) según sensibilidad
      state.trackX = state.trackX * (1 - s) + tx * s;
      state.trackY = state.trackY * (1 - s) + ty * s;
    }

    hudLuma.textContent = (state.luma * 100).toFixed(0) + '%';
  }

  // ------------------------------------------------------------------
  // Bucle de render principal
  // ------------------------------------------------------------------
  function loop(now) {
    if (!state.started) return;

    const dt = now - state.lastTime;
    state.lastTime = now;
    state.fps = 0.9 * state.fps + 0.1 * (1000 / Math.max(dt, 1));
    hudFps.textContent = state.fps.toFixed(0);

    analyzeFrame();

    // Subir frame de cámara a textura actual
    gl.bindTexture(gl.TEXTURE_2D, state.texCurrent);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video);

    // Coordenadas UV para cubrir el visor (cover) según aspecto de video vs canvas
    const vAspect = state.videoW / state.videoH;
    const cAspect = canvas.width / canvas.height;
    const sx = canvas.width / state.videoW;
    const sy = canvas.height / state.videoH;
    const s = Math.max(sx, sy);
    const uvScaleX = (state.videoW * s) / canvas.width;
    const uvScaleY = (state.videoH * s) / canvas.height;
    const uvOffX = ((state.videoW * s) - canvas.width) / (2 * state.videoW * s);
    const uvOffY = ((state.videoH * s) - canvas.height) / (2 * state.videoH * s);

    // Suavizado del slide (mejora pedida)
    state.slideX += (state.slideTargetX - state.slideX) * state.slideSmooth;
    state.slideY += (state.slideTargetY - state.slideY) * state.slideSmooth;

    gl.useProgram(state.prog);
    gl.viewport(0, 0, canvas.width, canvas.height);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, state.texCurrent);
    gl.uniform1i(state.loc.sampler, 0);

    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, state.texPrev);
    gl.uniform1i(state.loc.prev, 1);

    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, state.texNoise);
    gl.uniform1i(state.loc.noise, 2);

    gl.uniform2f(state.loc.resolution, canvas.width, canvas.height);
    gl.uniform2f(state.loc.uvScale, uvScaleX, uvScaleY);
    gl.uniform2f(state.loc.uvOffset, uvOffX, uvOffY);
    gl.uniform2f(state.loc.slide, state.slideX, state.slideY);
    gl.uniform1f(state.loc.time, now * 0.001);
    gl.uniform1f(state.loc.luma, state.luma);
    gl.uniform1f(state.loc.threshold, state.threshold);
    gl.uniform1f(state.loc.noiseAmt, state.noiseAmt);
    gl.uniform1f(state.loc.mosaic, state.mosaic);
    gl.uniform1f(state.loc.trackSens, state.trackSens);
    gl.uniform1f(state.loc.shapeMotion, state.shapeMotion);
    gl.uniform1f(state.loc.flicker, state.flicker);
    gl.uniform2f(state.loc.trackPos, state.trackX, state.trackY);
    gl.uniform1i(state.loc.invert, state.invert ? 1 : 0);

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    // Guardar frame actual como "anterior" para el cálculo de movimiento
    gl.bindTexture(gl.TEXTURE_2D, state.texPrev);
    gl.copyTexSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 0, 0, canvas.width, canvas.height);

    if (state.recording && state.mediaRecorder && state.mediaRecorder.state === 'recording') {
      // El MediaRecorder ya consume el stream del canvas; no hay que hacer nada aquí.
    }

    state.raf = requestAnimationFrame(loop);
  }

  // ------------------------------------------------------------------
  // Bindings de controles (sliders → estado)
  // ------------------------------------------------------------------
  function bindSlider(id, setter) {
    const el = $(id);
    const valEl = $(id.replace('s', 'v'));
    el.addEventListener('input', (e) => {
      const v = parseFloat(e.target.value);
      setter(v);
      if (valEl) valEl.textContent = v.toFixed(2);
    });
  }

  bindSlider('sThreshold', (v) => { state.threshold = v; });
  bindSlider('sNoiseAmt', (v) => { state.noiseAmt = v; });
  $('ckInvert').addEventListener('change', (e) => { state.invert = e.target.checked; });

  bindSlider('sMosaic', (v) => { state.mosaic = v; });
  bindSlider('sMosaicSens', (v) => { state.mosaicSens = v; }); // expuesto por coherencia de UI

  bindSlider('sTrackSens', (v) => { state.trackSens = v; });
  bindSlider('sShapeMotion', (v) => { state.shapeMotion = v; });
  bindSlider('sFlicker', (v) => { state.flicker = v; });

  bindSlider('sSlideX', (v) => { state.slideTargetX = v; });
  bindSlider('sSlideY', (v) => { state.slideTargetY = v; });
  bindSlider('sSlideSmooth', (v) => { state.slideSmooth = v; });

  // ------------------------------------------------------------------
  // Grabación con MediaRecorder (canvas → stream)
  // ------------------------------------------------------------------
  function toggleRecording() {
    if (state.recording) {
      stopRecording();
    } else {
      startRecording();
    }
  }

  async function startRecording() {
    if (!canvas.captureStream) {
      alert('canvas.captureStream no disponible en este navegador.');
      return;
    }
    try {
      const stream = canvas.captureStream(30);
      let mime = 'video/webm; codecs=vp8';
      if (!MediaRecorder.isTypeSupported(mime)) mime = 'video/webm';
      if (!MediaRecorder.isTypeSupported(mime)) mime = '';
      state.mediaRecorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      state.recordedChunks = [];

      state.mediaRecorder.ondataavailable = (e) => {
        if (e.data.size) state.recordedChunks.push(e.data);
      };

      state.mediaRecorder.onstop = () => {
        const blob = new Blob(state.recordedChunks, { type: state.mediaRecorder.mimeType || 'video/webm' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `glitch-lab-${Date.now()}.webm`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      };

      state.mediaRecorder.start(1000);
      state.recording = true;
      state.mediaRecorder.stream = stream;
      $('btnRecord').textContent = '■ Detener grabación';
      $('btnRecord').classList.add('recording');
      hudRec.classList.remove('hidden');
    } catch (err) {
      console.error('Error de grabación:', err);
      alert('No se pudo iniciar la grabación.');
    }
  }

  function stopRecording() {
    if (state.mediaRecorder && state.mediaRecorder.state === 'recording') {
      state.mediaRecorder.stop();
      state.mediaRecorder.stream.getTracks().forEach((t) => t.stop());
    }
    state.recording = false;
    $('btnRecord').textContent = '● Grabar historia (9:16)';
    $('btnRecord').classList.remove('recording');
    hudRec.classList.add('hidden');
  }

  $('btnRecord').addEventListener('click', toggleRecording);

  // ------------------------------------------------------------------
  // Presets con IndexedDB
  // ------------------------------------------------------------------
  const DB_NAME = 'glitch-lab';
  const DB_VER = 1;
  const DB_STORE = 'presets';

  function dbOpen() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VER);
      req.onupgradeneeded = () => {
        req.result.createObjectStore(DB_STORE, { keyPath: 'id', autoIncrement: true });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  function presetSave(settings) {
    return dbOpen().then((db) => {
      return new Promise((resolve, reject) => {
        const tx = db.transaction(DB_STORE, 'readwrite');
        const store = tx.objectStore(DB_STORE);
        const req = store.add({ ...settings, createdAt: Date.now() });
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
        tx.oncomplete = () => db.close();
      });
    });
  }

  function presetList() {
    return dbOpen().then((db) => {
      return new Promise((resolve, reject) => {
        const tx = db.transaction(DB_STORE, 'readonly');
        const store = tx.objectStore(DB_STORE);
        const req = store.getAll();
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
        tx.oncomplete = () => db.close();
      });
    });
  }

  function presetDelete(id) {
    return dbOpen().then((db) => {
      return new Promise((resolve, reject) => {
        const tx = db.transaction(DB_STORE, 'readwrite');
        tx.objectStore(DB_STORE).delete(id);
        tx.onsuccess = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.oncomplete = () => db.close();
      });
    });
  }

  function capturePreset() {
    return {
      name: 'Preset ' + new Date().toLocaleString(),
      threshold: state.threshold,
      noiseAmt: state.noiseAmt,
      invert: state.invert,
      mosaic: state.mosaic,
      trackSens: state.trackSens,
      shapeMotion: state.shapeMotion,
      flicker: state.flicker,
      slideX: state.slideTargetX,
      slideY: state.slideTargetY
    };
  }

  function applyPreset(p) {
    state.threshold = p.threshold;
    state.noiseAmt = p.noiseAmt;
    state.invert = p.invert || false;
    state.mosaic = p.mosaic;
    state.trackSens = p.trackSens;
    state.shapeMotion = p.shapeMotion;
    state.flicker = p.flicker;
    state.slideTargetX = p.slideX;
    state.slideTargetY = p.slideY;

    $('sThreshold').value = p.threshold;
    $('vThreshold').textContent = p.threshold.toFixed(2);
    $('sNoiseAmt').value = p.noiseAmt;
    $('vNoiseAmt').textContent = p.noiseAmt.toFixed(2);
    $('ckInvert').checked = !!p.invert;
    $('sMosaic').value = p.mosaic;
    $('vMosaic').textContent = p.mosaic.toFixed(2);
    $('sTrackSens').value = p.trackSens;
    $('vTrackSens').textContent = p.trackSens.toFixed(2);
    $('sShapeMotion').value = p.shapeMotion;
    $('vShapeMotion').textContent = p.shapeMotion.toFixed(2);
    $('sFlicker').value = p.flicker;
    $('vFlicker').textContent = p.flicker.toFixed(2);
    $('sSlideX').value = p.slideX;
    $('vSlideX').textContent = p.slideX.toFixed(2);
    $('sSlideY').value = p.slideY;
    $('vSlideY').textContent = p.slideY.toFixed(2);
  }

  async function renderPresetList() {
    try {
      const presets = await presetList();
      const list = $('presetList');
      list.innerHTML = '';
      presets.forEach((p) => {
        const wrap = document.createElement('div');
        wrap.style.display = 'flex';
        wrap.style.gap = '6px';
        wrap.style.marginBottom = '6px';
        wrap.innerHTML = `
          <button class="btn btn-sm" data-load="${p.id}" style="flex:1">${p.name}</button>
          <button class="btn btn-sm" data-del="${p.id}" style="width:28px">×</button>
        `;
        wrap.querySelector(`[data-load="${p.id}"]`).addEventListener('click', () => applyPreset(p));
        wrap.querySelector(`[data-del="${p.id}"]`).addEventListener('click', async () => {
          await presetDelete(p.id);
          renderPresetList();
        });
        list.appendChild(wrap);
      });
    } catch (e) {
      console.warn('IndexedDB no disponible:', e);
    }
  }

  $('btnSavePreset').addEventListener('click', async () => {
    await presetSave(capturePreset());
    renderPresetList();
  });
  $('btnLoadPreset').addEventListener('click', renderPresetList);

  // ------------------------------------------------------------------
  // Instalación PWA (beforeinstallprompt en Android/Chrome; iOS es manual)
  // ------------------------------------------------------------------
  let deferredInstallPrompt = null;
  const overlayInstall = $('overlayInstall');
  const btnInstall = $('btnInstall');
  const btnCloseInstall = $('btnCloseInstall');

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredInstallPrompt = e;
    overlayInstall.classList.remove('hidden');
  });

  btnInstall.addEventListener('click', async () => {
    if (deferredInstallPrompt) {
      deferredInstallPrompt.prompt();
      const choice = await deferredInstallPrompt.userChoice;
      if (choice.outcome === 'accepted') {
        overlayInstall.classList.add('hidden');
      }
      deferredInstallPrompt = null;
    }
  });

  btnCloseInstall.addEventListener('click', () => {
    overlayInstall.classList.add('hidden');
  });

  // ------------------------------------------------------------------
  // Inicio
  // ------------------------------------------------------------------
  $('btnStart').addEventListener('click', initCamera);

  if (!gl) {
    statusList.innerHTML += '<li style="color:var(--red)">WebGL 2 no detectado. Prueba en otro navegador o dispositivo.</li>';
  }

  // Exponer para consola de depuración
  window.GLITCH_LAB = { state, toggleRecording, applyPreset, renderPresetList };
})();
