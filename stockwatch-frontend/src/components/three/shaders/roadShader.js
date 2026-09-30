import * as THREE from 'three'

// French National Flag Colorway GLSL Highway Shader (Bleu #002654, Blanc #FFFFFF, Rouge #CE1126)
export const RoadShaderMaterial = {
  uniforms: {
    uTime: { value: 0 },
    uSpeed: { value: 1.5 },
    uIntensity: { value: 1.0 },
    uColorBg: { value: new THREE.Color('#020814') },
    uColorGrid: { value: new THREE.Color('#002654') },
    uColorWhite: { value: new THREE.Color('#ffffff') },
    uColorRed: { value: new THREE.Color('#ce1126') },
    uColorBlue: { value: new THREE.Color('#0055a4') },
  },
  vertexShader: `
    varying vec2 vUv;
    varying vec3 vPosition;

    void main() {
      vUv = uv;
      vPosition = position;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    uniform float uTime;
    uniform float uSpeed;
    uniform float uIntensity;
    uniform vec3 uColorBg;
    uniform vec3 uColorGrid;
    uniform vec3 uColorWhite;
    uniform vec3 uColorRed;
    uniform vec3 uColorBlue;

    varying vec2 vUv;
    varying vec3 vPosition;

    void main() {
      // Forward velocity motion coordinate along Y
      float forwardY = vUv.y * 36.0 - uTime * uSpeed * 14.0;
      float coordX = vUv.x * 2.0 - 1.0; // -1.0 to 1.0 across road width

      // Deep French Navy asphalt base
      vec3 color = uColorBg;

      // Outer highway boundary laser rails (Vibrant French Red #CE1126)
      float roadEdge = smoothstep(0.86, 0.88, abs(coordX));
      color = mix(color, uColorRed * 1.3, roadEdge * uIntensity);

      // Diffuse red glow
      float railGlow = smoothstep(0.92, 0.99, abs(coordX));
      color += uColorRed * railGlow * 0.7 * uIntensity;

      // Center dashed lane dividers (Crisp French White #FFFFFF)
      float centerDashes = step(0.48, fract(forwardY * 0.16)) * (1.0 - smoothstep(0.0, 0.025, abs(coordX)));
      color = mix(color, uColorWhite * 1.5, centerDashes * uIntensity);

      // Dual secondary lane dividers (French Royal Blue #0055A4)
      float leftLane = step(0.48, fract(forwardY * 0.16 + 0.5)) * (1.0 - smoothstep(0.44, 0.46, abs(coordX)));
      float rightLane = step(0.48, fract(forwardY * 0.16 + 0.5)) * (1.0 - smoothstep(0.44, 0.46, abs(coordX)));
      color += uColorBlue * (leftLane + rightLane) * 0.85 * uIntensity;

      // French Navy cyber grid texture
      float gridY = step(0.94, fract(forwardY * 0.4));
      float gridX = step(0.97, fract(abs(coordX) * 10.0));
      float grid = max(gridX, gridY);
      color += uColorGrid * grid * 0.5;

      // Distance horizon fog falloff into midnight blue
      float depthFade = smoothstep(0.02, 0.75, vUv.y);
      color = mix(vec3(0.0, 0.04, 0.1), color, depthFade);

      gl_FragColor = vec4(color, 1.0);
    }
  `,
}
