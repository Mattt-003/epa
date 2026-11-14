const SHADERS = {
  vertex: `#version 300 es
in vec2 a_position;
in vec2 a_texCoord;
out vec2 v_uv;
void main() {
  gl_Position = vec4(a_position, 0.0, 1.0);
  v_uv = a_texCoord;
}
`,

  fragment: `#version 300 es
precision highp float;

uniform sampler2D u_sampler;
uniform sampler2D u_prev;
uniform sampler2D u_noise;
uniform vec2  u_resolution;
uniform vec2  u_uvScale;
uniform vec2  u_uvOffset;
uniform vec2  u_slide;
uniform float u_time;
uniform float u_luma;       // luminancia promedio de la escena (0-1)
uniform float u_threshold;  // umbral de aislamiento (rótoscopia simulada)
uniform float u_noiseAmt;   // cantidad de ruido/textura
uniform float u_mosaic;     // intensidad de mosaicos
uniform float u_trackSens;  // sensibilidad del tracking de luz
uniform float u_shapeMotion;// sensibilidad al movimiento (formas)
uniform float u_flicker;    // intensidad de flicker
uniform vec2  u_trackPos;   // punto brillante más intenso (normalizado)
uniform int   u_invert;     // invertir máscara de aislamiento

in vec2 v_uv;
out vec4 outColor;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash(i + vec2(0.0, 0.0));
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

void main() {
  // Coordenadas de textura ajustadas para cubrir el visor 9:16 (cover)
  vec2 uv = (v_uv - u_uvOffset) * u_uvScale;

  // Frame actual y frame anterior (para movimiento)
  vec4 curr = texture(u_sampler, fract(uv + u_slide));
  vec4 prev = texture(u_prev, fract(uv + u_slide));

  float luma = dot(curr.rgb, vec3(0.299, 0.587, 0.114));
  float motion = length(curr.rgb - prev.rgb);

  // ----------------------------------------------------------------
  // 1. Róscopia / aislamiento por luminancia (fondo limpio)
  //    Cada objeto que entre al encuadre y supere el umbral se aísla.
  // ----------------------------------------------------------------
  float lumaKey = luma + (noise(uv * 8.0 + u_time * 2.0) * 2.0 - 1.0) * u_noiseAmt * 0.5;
  float mask = smoothstep(u_threshold, u_threshold + 0.07, lumaKey);
  if (u_invert == 1) mask = 1.0 - mask;
  vec3 iso = mix(vec3(0.035, 0.035, 0.045), curr.rgb, mask);

  // ----------------------------------------------------------------
  // 2. Mosaicos no uniformes según la luz
  //    El tamaño del bloque varía con la luminancia local y de escena.
  // ----------------------------------------------------------------
  float sceneLight = u_luma;
  float blockSize = mix(1.0, 80.0, u_mosaic * (1.0 - sceneLight * 0.5 + luma * 0.5));
  blockSize = max(blockSize, 1.0);
  vec2 grid = floor(uv * blockSize) / blockSize;
  vec4 mos = texture(u_sampler, fract((grid + u_slide) * u_uvScale + u_uvOffset));
  float mosaicWeight = u_mosaic * (1.0 - luma * 0.7 - sceneLight * 0.3);
  iso = mix(iso, mos.rgb, clamp(mosaicWeight, 0.0, 1.0));

  // ----------------------------------------------------------------
  // 3. Tracking por luz (sigue el punto más brillante)
  // ----------------------------------------------------------------
  float trackPull = u_trackSens * sceneLight * 0.55;
  vec2 toTrack = u_trackPos - uv;
  vec2 trackUv = uv + toTrack * trackPull * 0.5;
  vec4 trk = texture(u_sampler, fract(trackUv + u_slide));
  iso = mix(iso, trk.rgb, clamp(trackPull * 0.7, 0.0, 1.0));

  // ----------------------------------------------------------------
  // 4. Formas sensibles al movimiento (desplazamiento vectorial)
  // ----------------------------------------------------------------
  float shapeAmt = motion * u_shapeMotion * 0.018;
  vec2 shapeOffset = vec2(
    sin(uv.y * 70.0 + u_time) * shapeAmt,
    cos(uv.x * 70.0 + u_time) * shapeAmt
  );
  vec4 shp = texture(u_sampler, fract(uv + shapeOffset + u_slide));
  iso = mix(iso, shp.rgb, clamp(shapeAmt * 3.0, 0.0, 1.0));

  // ----------------------------------------------------------------
  // 5. Flicker mejorado (estocástico, ligado a luz y movimiento)
  // ----------------------------------------------------------------
  float flickWave = 1.0 + (noise(vec2(u_time * 9.0, uv.x + uv.y)) - 0.5) * 2.0
                    * u_flicker * (0.4 + luma * 0.6 + motion * 2.0);
  iso *= flickWave;

  // ----------------------------------------------------------------
  // 6. Grano de textura (ruido a gusto)
  // ----------------------------------------------------------------
  vec3 grain = texture(u_noise, uv * 6.0 + u_time * 0.4).rgb;
  iso += grain * u_noiseAmt * 0.14;

  outColor = vec4(iso, 1.0);
}
`
};
