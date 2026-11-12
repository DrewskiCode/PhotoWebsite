// GLSL for the gallery. Lighting is baked: surfaces are albedo x lightmap,
// with a planar reflection on the polished floors.

const HEAD = `#version 300 es
precision highp float;
`;

const TONE = `
uniform float uExposure;
vec3 tone(vec3 c){ c = 1.0 - exp(-c * uExposure * 1.25); return pow(c, vec3(0.4545)); }
vec3 untone(vec3 d){ d = pow(d, vec3(2.2)); return -log(max(1.0 - d, vec3(0.004))) / (uExposure * 1.25); }
`;

export const WORLD_VS = HEAD + `
layout(location=0) in vec3 aPos;
layout(location=1) in vec2 aLm;
uniform mat4 uVP; uniform float uQ;
out vec3 vW; out vec2 vLm;
void main(){ vW = aPos * uQ; vLm = aLm; gl_Position = uVP * vec4(vW, 1.0); }
`;

export const SURFACE_FS = HEAD + TONE + `
uniform sampler2D uLm, uDetail, uRefl;
uniform vec3 uAlbedo, uCam;
uniform vec4 uDet;            // channel weights (rgb), amplitude (a)
uniform float uScale, uGloss, uLmRange;
uniform vec2 uInvRes;
in vec3 vW; in vec2 vLm; out vec4 o;
void main(){
  vec3 n = normalize(cross(dFdx(vW), dFdy(vW)));
  vec3 w = pow(abs(n), vec3(8.0)); w /= (w.x + w.y + w.z);
  vec3 p = vW * uScale;
  float d = 0.5;
  if (uDet.a > 0.0) {
    vec3 t = texture(uDetail, p.zy).rgb * w.x + texture(uDetail, p.xz).rgb * w.y + texture(uDetail, p.xy).rgb * w.z;
    d = dot(t, uDet.rgb);
  }
  vec3 L = pow(texture(uLm, vLm).rgb, vec3(2.2)) * uLmRange;
  vec3 c = uAlbedo * (1.0 + (d - 0.5) * 2.0 * uDet.a) * L;
  if (uGloss > 0.0) {
    vec3 v = normalize(uCam - vW);
    float F = 0.035 + 0.6 * pow(1.0 - clamp(v.y, 0.0, 1.0), 5.0);
    float rough = clamp(1.0 - uGloss + (d - 0.5) * 0.9, 0.0, 1.0);
    vec2 suv = gl_FragCoord.xy * uInvRes + (d - 0.5) * 0.012;
    vec3 r = untone(textureLod(uRefl, suv, 0.8 + rough * 3.5).rgb);
    c = c * (1.0 - F * 0.6) + r * F * (0.5 + 0.5 * uGloss);
  }
  o = vec4(tone(c), 1.0);
}
`;

// unbaked props: palms, mullions, frames, roofs. Simple sun + sky lambert.
export const UNLIT_FS = HEAD + TONE + `
uniform vec3 uAlbedo, uSun, uSunCol, uSkyCol;
uniform float uFlip, uSunAmt;
in vec3 vW; in vec2 vLm; out vec4 o;
void main(){
  vec3 n = normalize(cross(dFdx(vW), dFdy(vW))) * uFlip;
  vec3 L = uSunCol * max(dot(n, uSun), 0.0) * uSunAmt + uSkyCol * (0.6 + 0.4 * n.y);
  o = vec4(tone(uAlbedo * L), 1.0);
}
`;

export const SKY_VS = HEAD + `
layout(location=0) in vec2 aPos;
uniform vec3 uF, uR, uU; uniform vec2 uTan;
out vec3 vRay;
void main(){ vRay = uF + uR * aPos.x * uTan.x + uU * aPos.y * uTan.y; gl_Position = vec4(aPos, 1.0, 1.0); }
`;

export const SKY_FS = HEAD + TONE + `
uniform vec3 uSun, uCam, uGround;
uniform float uFlip;
in vec3 vRay; out vec4 o;
void main(){
  vec3 d = normalize(vRay); d.y *= uFlip;
  float h = d.y;
  vec3 c = mix(vec3(1.55, 1.9, 2.5), vec3(0.42, 0.85, 2.3), pow(clamp(h, 0.0, 1.0), 0.5));
  float sd = max(dot(d, uSun), 0.0);
  c += vec3(1.0, 0.85, 0.6) * (pow(sd, 1400.0) * 40.0 + pow(sd, 24.0) * 0.55 + pow(sd, 4.0) * 0.18);
  float az = atan(d.z, d.x);
  float ridge = 0.028 + 0.016 * sin(az * 3.0 + 1.0) + 0.010 * sin(az * 7.0 + 2.3) + 0.005 * sin(az * 19.0) + 0.003 * sin(az * 41.0);
  vec3 hills = mix(vec3(0.75, 1.0, 1.45), vec3(1.2, 1.5, 2.0), smoothstep(0.0, 0.05, h));
  c = mix(hills, c, smoothstep(ridge - 0.003, ridge + 0.001, h));
  if (h < 0.0) {
    float t = -uCam.y / min(h, -1e-4);
    c = mix(uGround, vec3(1.3, 1.6, 2.0), 1.0 - exp(-t * 0.006));
  }
  o = vec4(tone(c), 1.0);
}
`;

export const QUAD_VS = HEAD + `
layout(location=0) in vec2 aPos;       // 0..1
uniform mat4 uVP; uniform vec3 uO, uRt, uUp; uniform vec4 uUV; uniform vec2 uLmUV[4];
out vec2 vUV; out vec2 vLm; out vec3 vW;
void main(){
  vW = uO + uRt * (aPos.x - 0.5) + uUp * (aPos.y - 0.5);
  vUV = uUV.xy + vec2(aPos.x, 1.0 - aPos.y) * uUV.zw;
  vLm = mix(mix(uLmUV[0], uLmUV[1], aPos.x), mix(uLmUV[3], uLmUV[2], aPos.x), aPos.y);
  gl_Position = uVP * vec4(vW, 1.0);
}
`;

export const PHOTO_FS = HEAD + `
uniform sampler2D uTex; uniform float uBright;
in vec2 vUV; out vec4 o;
void main(){ o = vec4(texture(uTex, vUV).rgb * uBright, 1.0); }
`;

// wall graphics: ink printed on the wall, lit by the wall's own lightmap
export const LABEL_FS = HEAD + TONE + `
uniform sampler2D uTex, uLm; uniform float uGlow, uLmRange;
in vec2 vUV; in vec2 vLm; out vec4 o;
void main(){
  vec4 t = texture(uTex, vUV);
  if (t.a < 0.004) discard;
  vec3 ink = pow(t.rgb / t.a, vec3(2.2));
  vec3 L = uGlow > 0.0 ? vec3(uGlow) : pow(texture(uLm, vLm).rgb, vec3(2.2)) * uLmRange;
  o = vec4(tone(ink * L) * t.a, t.a);
}
`;

export const GLASS_VS = HEAD + `
layout(location=0) in vec3 aPos;
uniform mat4 uVP; out vec3 vW;
void main(){ vW = aPos; gl_Position = uVP * vec4(aPos, 1.0); }
`;

export const GLASS_FS = HEAD + TONE + `
uniform vec3 uCam; uniform float uFlip;
in vec3 vW; out vec4 o;
void main(){
  vec3 v = normalize(uCam - vW);
  vec3 n = normalize(cross(dFdx(vW), dFdy(vW))) * uFlip;
  float F = 0.04 + 0.96 * pow(1.0 - abs(dot(n, v)), 5.0);
  vec3 r = reflect(-v, n);
  vec3 sky = r.y > 0.0 ? mix(vec3(1.5, 1.8, 2.3), vec3(0.5, 0.9, 2.2), pow(r.y, 0.5)) : vec3(0.5);
  float a = F * 0.8;
  o = vec4(tone(sky) * a, a + 0.035);
}
`;
