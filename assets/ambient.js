/* BLACKBOX reading-page background: a black hole.
   A WebGL fragment shader traces light rays around a Schwarzschild black hole: rays bend towards
   the hole, cross a hot, turbulent accretion disk (brighter on the side spinning towards you) and
   otherwise land on a star field that gets lensed into rings near the edge of the shadow.
   Opening a page warps you in; as you read, you drift closer; finishing lights the disk up.
   Rendered at a fraction of screen resolution and capped at ~30 fps, it downgrades itself on slow
   GPUs, pauses in background tabs and draws one still frame for reduced-motion readers. */
(function () {
  "use strict";
  var layout = document.querySelector(".lesson-layout");
  if (!layout || !window.requestAnimationFrame) return;

  var canvas = document.createElement("canvas");
  canvas.className = "ambient-bg";
  canvas.setAttribute("aria-hidden", "true");
  document.body.insertBefore(canvas, document.body.firstChild);
  document.body.classList.add("ambient-on");

  var reduced = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
  var gl = null;
  try { gl = canvas.getContext("webgl", { antialias: false, alpha: false, depth: false, powerPreference: "low-power" }) || canvas.getContext("experimental-webgl"); } catch (e) {}
  if (!gl) return fallback();

  var VS = "attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}";
  var FS = [
    "precision highp float;",
    "uniform vec2 uRes;uniform float uTime,uDist,uGlow,uWarp,uTilt,uYaw;uniform vec2 uCenter;",
    "float h21(vec2 p){p=fract(p*vec2(123.34,456.21));p+=dot(p,p+45.32);return fract(p.x*p.y);}",
    "float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);",
    " return mix(mix(h21(i),h21(i+vec2(1,0)),f.x),mix(h21(i+vec2(0,1)),h21(i+vec2(1,1)),f.x),f.y);}",
    "float fbm(vec2 p){float v=0.,a=.5;for(int i=0;i<4;i++){v+=a*noise(p);p=p*2.03+vec2(1.7,9.2);a*=.5;}return v;}",
    // stars + faint nebula for an escaping ray direction
    "vec3 sky(vec3 d){",
    " vec2 sp=vec2(atan(d.z,d.x),asin(clamp(d.y,-1.,1.)));vec3 c=vec3(0.);",
    " for(int L=0;L<2;L++){float sc=L==0?90.:220.;vec2 g=sp*sc;vec2 id=floor(g),f=fract(g)-.5;",
    "  float h=h21(id+float(L)*17.);if(h>.965){vec2 o=vec2(h21(id+3.),h21(id+7.))-.5;float s=length(f-o*.6);",
    "   float b=(h-.965)/.035;c+=mix(vec3(1.,.85,.7),vec3(.75,.85,1.),h21(id+11.))*b*b*smoothstep(.12,0.,s)*(L==0?1.6:.9);}}",
    " float n=fbm(sp*vec2(2.2,4.)+3.);c+=vec3(.55,.32,.18)*pow(n,3.)*.10+vec3(.12,.14,.25)*pow(fbm(sp*3.+9.),2.)*.08;",
    " return c;}",
    "void main(){",
    " vec2 uv=(gl_FragCoord.xy-.5*uRes)/uRes.y-uCenter;",
    // camera: slightly above the disk plane, slowly orbiting
    " vec3 cam=vec3(sin(uYaw)*cos(uTilt),sin(uTilt),-cos(uYaw)*cos(uTilt))*uDist;",
    " vec3 fw=normalize(-cam),rt=normalize(cross(vec3(0,1,0),fw)),up=cross(fw,rt);",
    " vec3 dir=normalize(fw*1.35+uv.x*rt+uv.y*up);",
    " vec3 pos=cam,vel=dir;vec3 hv=cross(pos,vel);float h2=dot(hv,hv);",
    " vec3 col=vec3(0.);float alpha=0.,glow=0.;bool captured=false;",
    " for(int i=0;i<140;i++){",
    "  float r=length(pos);",
    "  float dt=clamp(.12*r-.15,.04,2.2);",
    "  vec3 acc=-1.5*h2*pos/pow(r,5.);",
    "  vec3 np=pos+vel*dt;vel+=acc*dt;",
    "  glow+=exp(-(r-1.6)*(r-1.6)*6.)*dt*.035;",
    "  if(pos.y*np.y<0.){",
    "   vec3 hit=mix(pos,np,pos.y/(pos.y-np.y));float rr=length(hit.xz);",
    "   if(rr>2.4&&rr<16.){",
    "    float ang=atan(hit.z,hit.x)+uTime*1.6/pow(rr,1.5);",
    "    float n=fbm(vec2(rr*2.4,ang*5.))*.7+fbm(vec2(rr*9.,ang*18.))*.3;",
    "    float inten=pow(3./rr,2.3)*smoothstep(2.4,3.3,rr)*(1.-smoothstep(10.,16.,rr));",
    "    vec3 dv=normalize(vec3(-hit.z,0.,hit.x));float beam=clamp(1.+.55*dot(dv,-normalize(vel)),.3,1.7);",
    "    float temp=clamp(inten*1.2*beam,0.,1.);",
    "    vec3 c=mix(vec3(.85,.28,.05),vec3(1.,.8,.52),temp);c=mix(c,vec3(1.,.97,.9),smoothstep(.75,1.,temp));",
    "    float op=clamp(inten*(.35+1.1*n)*1.25,0.,.96);",
    "    col+=(1.-alpha)*c*(.5+1.4*n)*inten*beam*uGlow*2.8;alpha+=(1.-alpha)*op;",
    "    if(alpha>.97)break;}}",
    "  pos=np;",
    "  if(r<1.){captured=true;break;}",
    "  if(r>uDist*1.6&&dot(pos,vel)>0.)break;",
    " }",
    " if(!captured)col+=(1.-alpha)*sky(normalize(vel));",
    " col+=vec3(1.,.72,.42)*glow*uGlow*1.8;",
    // warp-in streaks
    " if(uWarp>.001){float a=atan(uv.y,uv.x),l=length(uv);float s=h21(vec2(floor(a*220.),3.));",
    "  float st=step(.86,s)*pow(fract(l*1.6-uTime*2.2*(.6+s)+s*7.),14.)*smoothstep(.05,.9,l);",
    "  col+=vec3(.95,.85,.7)*st*uWarp*1.4;col*=1.+uWarp*.6;}",
    " col=1.-exp(-col*1.35);col=pow(col,vec3(.92));",
    " vec2 q=gl_FragCoord.xy/uRes;col*=.35+.65*pow(16.*q.x*q.y*(1.-q.x)*(1.-q.y),.18);",
    " gl_FragColor=vec4(col,1.);}"
  ].join("\n");

  function shader(type, src) {
    var s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { if (window.console) console.warn(gl.getShaderInfoLog(s)); return null; }
    return s;
  }
  var vs = shader(gl.VERTEX_SHADER, VS), fs = shader(gl.FRAGMENT_SHADER, FS);
  if (!vs || !fs) return fallback();
  var prog = gl.createProgram();
  gl.attachShader(prog, vs); gl.attachShader(prog, fs); gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return fallback();
  gl.useProgram(prog);
  var buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  var loc = gl.getAttribLocation(prog, "p");
  gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  var U = {};
  ["uRes", "uTime", "uDist", "uGlow", "uWarp", "uTilt", "uYaw", "uCenter"].forEach(function (n) { U[n] = gl.getUniformLocation(prog, n); });

  // Quality: render at a fraction of the screen and step down if frames are slow.
  var scales = [0.5, 0.4, 0.32, 0.25], level = window.innerWidth < 700 ? 1 : 0;
  var W = 0, H = 0, t0 = performance.now(), last = 0, raf = 0, slow = 0, samples = 0;
  var read = 0, readTarget = 0, glow = 1, glowTarget = 1, flare = 0;
  var WARP_MS = reduced ? 0 : 2600;

  function resize() {
    var s = scales[level];
    W = Math.max(2, Math.round(window.innerWidth * s)); H = Math.max(2, Math.round(window.innerHeight * s));
    canvas.width = W; canvas.height = H;
    gl.viewport(0, 0, W, H);
  }
  function ease(x) { return 1 - Math.pow(1 - x, 3); }

  function frame(now) {
    raf = 0;
    var dt = Math.min(0.1, (now - last) / 1000 || 0.03); last = now;
    var ms = now - t0, t = ms / 1000;
    read += (readTarget - read) * Math.min(1, dt * 2);
    glow += (glowTarget - glow) * Math.min(1, dt * 1.5);
    flare = Math.max(0, flare - dt * 0.35);
    var warp = WARP_MS ? Math.max(0, 1 - ms / WARP_MS) : 0;
    var wide = window.innerWidth >= 1100;
    // fly in during the warp, then drift closer as you read
    var dist = (wide ? 15 : 19) - 4 * read + 60 * Math.pow(warp, 1.6);
    gl.uniform2f(U.uRes, W, H);
    gl.uniform1f(U.uTime, t);
    gl.uniform1f(U.uDist, dist);
    gl.uniform1f(U.uGlow, glow + flare * 1.6);
    gl.uniform1f(U.uWarp, ease(warp));
    gl.uniform1f(U.uTilt, 0.1 + 0.03 * Math.sin(t * 0.05));
    gl.uniform1f(U.uYaw, t * 0.012);
    gl.uniform2f(U.uCenter, 0.0, wide ? 0.1 : 0.16);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // adaptive quality: after the warp, watch frame cost and step down if we're struggling
    if (!reduced && !warp) {
      var cost = performance.now() - now;
      samples++; if (dt > 0.05 || cost > 22) slow++;
      if (samples >= 45) { if (slow > 20 && level < scales.length - 1) { level++; resize(); } samples = 0; slow = 0; }
    }
    if (!reduced) schedule();
  }
  function schedule() {
    if (raf || document.hidden) return;
    raf = requestAnimationFrame(function (now) {
      if (now - last < 32) { raf = 0; return schedule(); }   // ~30 fps
      frame(now);
    });
  }
  function redraw() { if (reduced) frame(performance.now()); else schedule(); }

  // ── progress: how far you've read / how much of the chapter is done ──
  function readProgress() {
    var max = document.documentElement.scrollHeight - innerHeight;
    return max > 0 ? Math.min(1, Math.max(0, scrollY / max)) : 0;
  }
  function chapterFraction() {
    var ticks = document.querySelectorAll(".be-sec[data-lesson]");
    if (!ticks.length || !window.BB) return 0;
    var done = 0;
    ticks.forEach(function (x) { if (BB.isDone(x.getAttribute("data-lesson"))) done++; });
    return done / ticks.length;
  }
  var art = document.querySelector("article.lesson"), lessonId = art && art.getAttribute("data-lesson-id");
  function complete() { return lessonId ? !!(window.BB && BB.isDone(lessonId)) : chapterFraction() >= 1; }
  function update() {
    readTarget = complete() ? 1 : Math.max(readProgress(), chapterFraction());
    glowTarget = 0.85 + 0.35 * Math.max(chapterFraction(), complete() ? 1 : 0);
    if (reduced) redraw();
  }
  var wasComplete = complete();
  window.addEventListener("scroll", update, { passive: true });
  window.addEventListener("resize", function () { resize(); redraw(); });
  document.addEventListener("visibilitychange", function () { if (!document.hidden) { last = performance.now(); schedule(); } });
  canvas.addEventListener("webglcontextlost", function (e) { e.preventDefault(); cancelAnimationFrame(raf); raf = 0; });
  if (window.BB && BB.on) BB.on(function (w) {
    if (w !== "progress") return;
    update();
    var now = complete();
    if (now && !wasComplete) { flare = 1; if (reduced) redraw(); }   // just finished: the disk flares
    wasComplete = now;
  });
  resize(); update(); read = readTarget; glow = glowTarget; redraw();

  // No WebGL: a still, hand-drawn black hole so the page keeps its mood.
  function fallback() {
    var g = canvas.getContext("2d");
    if (!g) return;
    function draw() {
      var w = canvas.width = innerWidth, h = canvas.height = innerHeight;
      g.fillStyle = "#040406"; g.fillRect(0, 0, w, h);
      for (var i = 0; i < 260; i++) { var a = Math.random(); g.fillStyle = "rgba(235,225,210," + (a * a * 0.8).toFixed(2) + ")"; g.fillRect(Math.random() * w, Math.random() * h, 1.2, 1.2); }
      var cx = w * (w >= 1100 ? 0.62 : 0.5), cy = h * 0.42, R = Math.min(w, h) * 0.17;
      var halo = g.createRadialGradient(cx, cy, R * 0.9, cx, cy, R * 2.4);
      halo.addColorStop(0, "rgba(255,190,110,.55)"); halo.addColorStop(0.25, "rgba(230,130,50,.22)"); halo.addColorStop(1, "rgba(0,0,0,0)");
      g.fillStyle = halo; g.beginPath(); g.arc(cx, cy, R * 2.4, 0, 6.283); g.fill();
      g.save(); g.translate(cx, cy); g.scale(1, 0.12);
      var disk = g.createRadialGradient(0, 0, R, 0, 0, R * 4.2);
      disk.addColorStop(0, "rgba(255,230,190,.95)"); disk.addColorStop(0.3, "rgba(240,150,60,.6)"); disk.addColorStop(1, "rgba(0,0,0,0)");
      g.fillStyle = disk; g.beginPath(); g.arc(0, 0, R * 4.2, 0, 6.283); g.fill(); g.restore();
      g.fillStyle = "#000"; g.beginPath(); g.arc(cx, cy, R, 0, 6.283); g.fill();
    }
    draw();
    window.addEventListener("resize", draw);
  }
})();
