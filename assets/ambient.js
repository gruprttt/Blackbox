/* BLACKBOX reading-page background: every chapter opens onto a different corner of space.
   Scenes (picked per page, so neighbouring chapters feel like different worlds):
     0  a distant black hole — ray-traced: light bends round it, the accretion disk glows brighter
        on the side spinning towards you, stars are lensed near its shadow
     1  the same kind of hole seen edge-on, disk slicing across the sky
     2  Earth from low orbit — blue atmosphere on the limb, city lights on the night side
     3  Mars — rust-red, cratered, a white polar cap, lit from the side
     4  a golden spiral galaxy, tilted, slowly turning
   Opening a page warps you in; while you read you drift a little closer; finishing makes it flare.
   One WebGL fragment shader at a fraction of screen resolution, ~30 fps, quality steps down on slow
   GPUs, pauses in background tabs, a single still frame for reduced motion, 2D fallback. */
(function () {
  "use strict";
  var layout = document.querySelector(".lesson-layout");
  if (!layout || !window.requestAnimationFrame) return;

  var SCENES = [
    { name: "Black hole", sub: "Event horizon · light bends here" },
    { name: "Accretion disk", sub: "Gravitational lensing · edge-on" },
    { name: "Earth", sub: "400 km · low orbit" },
    { name: "Mars", sub: "225,000,000 km" },
    { name: "Whirlpool", sub: "Spiral galaxy · 23 million light-years" }
  ];
  function hash(s) { var h = 2166136261; for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  var scene = hash(location.pathname.replace(/index\.html$/, "")) % SCENES.length;
  var pick = /[?&]scene=(\d)/.exec(location.search);   // ?scene=N previews a scene
  if (pick) scene = +pick[1] % SCENES.length;

  var canvas = document.createElement("canvas");
  canvas.className = "ambient-bg";
  canvas.setAttribute("aria-hidden", "true");
  document.body.insertBefore(canvas, document.body.firstChild);
  document.body.classList.add("ambient-on");
  var cap = document.createElement("div");
  cap.className = "ambient-caption"; cap.setAttribute("aria-hidden", "true");
  cap.innerHTML = "<b>" + SCENES[scene].name + "</b><span>" + SCENES[scene].sub + "</span>";
  var main = document.querySelector(".lesson-main");
  (main || document.body).appendChild(cap);

  var reduced = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
  var gl = null;
  try { gl = canvas.getContext("webgl", { antialias: false, alpha: false, depth: false, powerPreference: "low-power" }) || canvas.getContext("experimental-webgl"); } catch (e) {}
  if (!gl) return fallback();

  var VS = "attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}";
  var FS = [
    "precision highp float;",
    "uniform vec2 uRes,uCenter;uniform float uTime,uDist,uGlow,uWarp,uTilt,uYaw,uScene,uZoom,uRoll,uWide;",
    "float h21(vec2 p){p=fract(p*vec2(123.34,456.21));p+=dot(p,p+45.32);return fract(p.x*p.y);}",
    "float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);",
    " return mix(mix(h21(i),h21(i+vec2(1,0)),f.x),mix(h21(i+vec2(0,1)),h21(i+vec2(1,1)),f.x),f.y);}",
    "float fbm(vec2 p){float v=0.,a=.5;for(int i=0;i<5;i++){v+=a*noise(p);p=p*2.03+vec2(1.7,9.2);a*=.5;}return v;}",
    "mat2 rot(float a){float c=cos(a),s=sin(a);return mat2(c,-s,s,c);}",
    // star field + milky way for a view direction
    "vec3 sky(vec3 d){",
    " vec2 sp=vec2(atan(d.z,d.x),asin(clamp(d.y,-1.,1.)));vec3 c=vec3(0.);",
    " for(int L=0;L<3;L++){float sc=L==0?70.:L==1?160.:340.;vec2 g=sp*sc;vec2 id=floor(g),f=fract(g)-.5;",
    "  float h=h21(id+float(L)*17.);float th=L==2?.9:.955;if(h>th){vec2 o=vec2(h21(id+3.),h21(id+7.))-.5;float s=length(f-o*.6);",
    "   float b=(h-th)/(1.-th);float tw=.75+.25*sin(uTime*(1.+h*3.)+h*40.);",
    "   c+=mix(vec3(1.,.86,.7),vec3(.72,.82,1.),h21(id+11.))*b*b*smoothstep(.13,0.,s)*tw*(L==0?1.8:L==1?1.:.55);}}",
    // milky way: a tilted band of dust and faint stars
    " vec2 q=rot(.5)*sp;float band=exp(-q.y*q.y*9.);",
    " float dust=fbm(q*vec2(3.,7.)+2.);float lane=smoothstep(.45,.75,fbm(q*vec2(6.,14.)+8.));",
    " c+=band*(vec3(.42,.36,.46)*pow(dust,2.2)*.34*(1.-.7*lane)+vec3(.9,.75,.6)*pow(noise(q*400.),18.)*.8);",
    " return c;}",
    // ── black hole (ray traced) ──
    "vec3 blackhole(vec2 uv){",
    " vec3 cam=vec3(sin(uYaw)*cos(uTilt),sin(uTilt),-cos(uYaw)*cos(uTilt))*uDist;",
    " vec3 fw=normalize(-cam),rt=normalize(cross(vec3(0,1,0),fw)),up=cross(fw,rt);",
    " vec3 dir=normalize(fw*1.35+uv.x*rt+uv.y*up);",
    // far from the hole light barely bends: skip the march
    " if(length(uv)>28./uDist)return sky(dir);",
    " vec3 pos=cam,vel=dir;vec3 hv=cross(pos,vel);float h2=dot(hv,hv);",
    " vec3 col=vec3(0.);float alpha=0.,glow=0.;bool captured=false;",
    " for(int i=0;i<150;i++){",
    "  float r=length(pos);float dt=clamp(.12*r-.15,.04,2.6);",
    "  vec3 np=pos+vel*dt;vel+=-1.5*h2*pos/pow(r,5.)*dt;",
    "  glow+=exp(-(r-1.6)*(r-1.6)*6.)*dt*.035;",
    "  if(pos.y*np.y<0.){",
    "   vec3 hit=mix(pos,np,pos.y/(pos.y-np.y));float rr=length(hit.xz);",
    "   if(rr>2.4&&rr<16.){",
    "    float ang=atan(hit.z,hit.x)+uTime*1.6/pow(rr,1.5);",
    "    float n=fbm(vec2(rr*2.4,ang*5.))*.65+fbm(vec2(rr*11.,ang*22.))*.35;",
    "    float inten=pow(3./rr,2.3)*smoothstep(2.4,3.3,rr)*(1.-smoothstep(10.,16.,rr));",
    "    vec3 dv=normalize(vec3(-hit.z,0.,hit.x));float beam=clamp(1.+.55*dot(dv,-normalize(vel)),.3,1.7);",
    "    float temp=clamp(inten*1.2*beam,0.,1.);",
    "    vec3 c=mix(vec3(.85,.3,.06),vec3(1.,.8,.52),temp);c=mix(c,vec3(1.,.97,.9),smoothstep(.75,1.,temp));",
    "    float op=clamp(inten*(.35+1.1*n)*1.25,0.,.96);",
    "    col+=(1.-alpha)*c*(.45+1.5*n)*inten*beam*uGlow*2.8;alpha+=(1.-alpha)*op;",
    "    if(alpha>.97)break;}}",
    "  pos=np;",
    "  if(r<1.){captured=true;break;}",
    "  if(r>uDist*1.3&&dot(pos,vel)>0.)break;",
    " }",
    " if(!captured)col+=(1.-alpha)*sky(normalize(vel));",
    " return col+vec3(1.,.72,.42)*glow*uGlow*1.8;}",
    // ── a lit sphere (planets) ──
    "vec3 planet(vec2 uv,vec2 c,float R,vec3 L,int kind,out float cover){",
    " vec2 p=(uv-c)/R;float r=length(p);cover=0.;vec3 col=vec3(0.);",
    " vec3 atm=kind==0?vec3(.25,.55,1.):vec3(1.,.55,.3);",
    // atmosphere glow outside the limb, strongest where the sun is
    " float sunSide=clamp(dot(normalize(vec3(p,.0001)),normalize(L))*.5+.5,0.,1.);",
    " if(r>1.){float a=exp(-(r-1.)*(kind==0?14.:30.));col+=atm*a*(.3+1.6*pow(sunSide,3.))*(kind==0?1.2:.45);return col;}",
    " cover=smoothstep(1.,.995,r);",
    " vec3 n=vec3(p,sqrt(max(0.,1.-r*r)));float lit=dot(n,normalize(L));",
    " float lon=atan(n.x,n.z)+uTime*.006,lat=asin(clamp(n.y,-1.,1.));vec2 m=vec2(lon,lat);",
    " float day=smoothstep(-.08,.25,lit);",
    " if(kind==0){",
    "  float land=smoothstep(.5,.56,fbm(m*2.6+1.3));",
    "  vec3 surf=mix(vec3(.02,.07,.2),vec3(.12,.2,.1),land);",
    "  float cloud=smoothstep(.55,.8,fbm(m*4.+vec2(uTime*.004,0.)));surf=mix(surf,vec3(.85),cloud*.6);",
    "  col=surf*(max(lit,0.)*1.4+.035)+vec3(.02,.05,.12)*(1.-day);",
    "  float city=(pow(noise(m*90.),5.)*.8+pow(noise(m*260.),9.))*land*(1.-cloud*.8)*(1.-day)*smoothstep(.4,.62,fbm(m*7.))*14.;",
    "  col+=vec3(1.,.72,.35)*city;",
    " }else{",
    "  float h=fbm(m*3.+4.),cr=fbm(m*16.);",
    "  vec3 surf=mix(vec3(.55,.18,.07),vec3(.85,.42,.2),h);surf*=.75+.5*cr;",
    "  surf=mix(surf,vec3(.82,.78,.74),smoothstep(.93,.97,n.y+.03*noise(m*20.)));",
    "  col=surf*(pow(max(lit,0.),1.2)*.95+.015);",
    " }",
    // rim: atmosphere seen through the edge of the disc
    " float rim=pow(1.-n.z,3.);col+=atm*rim*(kind==0?.9:.18)*(.2+day);",
    " return col;}",
    // ── spiral galaxy ──
    "vec3 galaxy(vec2 uv){",
    " vec2 p=rot(-.45)*(uv-uCenter);p.y*=2.6;float r=length(p);float a=atan(p.y,p.x);",
    " float s=a+log(r+.02)*2.4-uTime*.02;",
    " float arms=pow(.5+.5*cos(s*2.),2.5);",
    " float dust=fbm(vec2(s*1.6,r*7.)),fine=fbm(vec2(s*5.,r*24.));",
    " float b=arms*(.35+dust)*(.6+fine)*exp(-r*2.)*1.4+exp(-r*r*40.)*2.2+exp(-r*5.)*.25;",
    " float lanes=smoothstep(.55,.8,fbm(vec2(s*3.,r*12.)+5.))*arms;",
    " vec3 c=mix(vec3(1.,.55,.15),vec3(1.,.9,.7),clamp(exp(-r*4.),0.,1.))*b*(1.-.6*lanes);",
    " c+=vec3(1.,.8,.55)*pow(noise(p*180.),20.)*arms*exp(-r*1.5)*3.;",
    " return c*uGlow;}",
    "void main(){",
    " vec2 uv=(gl_FragCoord.xy-.5*uRes)/uRes.y;",
    " vec3 dir=normalize(vec3(uv*rot(.1),1.4));",
    " vec3 col;int sc=int(uScene+.5);",
    " if(sc<=1){vec2 b=(uv-uCenter)*rot(uRoll);col=blackhole(b);}",
    " else if(sc==2){float cv;vec3 base=sky(dir);vec3 pl=planet(uv/uZoom,uCenter,1.05,vec3(-.1,.95,.25),0,cv);col=base*(1.-cv)+pl;}",
    " else if(sc==3){float cv;vec3 base=sky(dir);vec3 pl=planet(uv/uZoom,uCenter,uWide>.5?.5:.36,vec3(-.8,.35,.45),1,cv);col=base*(1.-cv)+pl*uGlow;}",
    " else{col=sky(dir)+galaxy(uv/uZoom);}",
    // warp-in streaks
    " if(uWarp>.001){float a=atan(uv.y,uv.x),l=length(uv);float s=h21(vec2(floor(a*220.),3.));",
    "  float st=step(.86,s)*pow(fract(l*1.6-uTime*2.2*(.6+s)+s*7.),14.)*smoothstep(.05,.9,l);",
    "  col+=vec3(.95,.85,.7)*st*uWarp*1.4;col*=1.+uWarp*.5;}",
    " col=1.-exp(-col*1.35);col=pow(col,vec3(.92));",
    " vec2 q=gl_FragCoord.xy/uRes;col*=.4+.6*pow(16.*q.x*q.y*(1.-q.x)*(1.-q.y),.16);",
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
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  var loc = gl.getAttribLocation(prog, "p");
  gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  var U = {};
  ["uRes", "uCenter", "uTime", "uDist", "uGlow", "uWarp", "uTilt", "uYaw", "uScene", "uZoom", "uRoll", "uWide"].forEach(function (n) { U[n] = gl.getUniformLocation(prog, n); });

  var scales = [0.5, 0.4, 0.32, 0.25], level = window.innerWidth < 700 ? 1 : 0;
  var W = 0, H = 0, t0 = performance.now(), last = 0, raf = 0, slow = 0, samples = 0;
  var read = 0, readTarget = 0, glow = 1, glowTarget = 1, flare = 0;
  var WARP_MS = reduced ? 0 : 2400;

  function resize() {
    var s = scales[level];
    W = Math.max(2, Math.round(window.innerWidth * s)); H = Math.max(2, Math.round(window.innerHeight * s));
    canvas.width = W; canvas.height = H;
    gl.viewport(0, 0, W, H);
  }
  function ease(x) { return 1 - Math.pow(1 - x, 3); }

  // Where each scene sits: in the open space around the reading column, never under all of it.
  function layoutFor(wide, aspect) {
    var edge = aspect / 2;   // uv x runs from -edge to +edge
    switch (scene) {
      case 0: return wide ? { c: [edge - 0.3, 0.2], dist: 58, tilt: 0.16, roll: 0.12 } : { c: [0.12, 0.3], dist: 70, tilt: 0.16, roll: 0.1 };
      case 1: return wide ? { c: [-edge + 0.45, -0.12], dist: 50, tilt: 0.035, roll: -0.42 } : { c: [0.0, 0.22], dist: 62, tilt: 0.035, roll: -0.4 };
      case 2: return { c: [0.0, wide ? -1.2 : -1.12] };
      case 3: return wide ? { c: [edge - 0.2, -0.36] } : { c: [0.26, 0.32] };
      default: return wide ? { c: [edge - 0.45, 0.2] } : { c: [0.05, 0.28] };
    }
  }

  function frame(now) {
    raf = 0;
    var dt = Math.min(0.1, (now - last) / 1000 || 0.03); last = now;
    var ms = now - t0, t = ms / 1000;
    read += (readTarget - read) * Math.min(1, dt * 2);
    glow += (glowTarget - glow) * Math.min(1, dt * 1.5);
    flare = Math.max(0, flare - dt * 0.35);
    var warp = WARP_MS ? Math.max(0, 1 - ms / WARP_MS) : 0, w = ease(warp);
    var wide = window.innerWidth >= 1000, L = layoutFor(wide, W / H);
    gl.uniform2f(U.uRes, W, H);
    gl.uniform2f(U.uCenter, L.c[0], L.c[1]);
    gl.uniform1f(U.uTime, t);
    gl.uniform1f(U.uScene, scene);
    gl.uniform1f(U.uWide, wide ? 1 : 0);
    // arrive from far away, then drift a little closer as you read
    gl.uniform1f(U.uDist, (L.dist || 60) * (1 - 0.14 * read) + 90 * Math.pow(warp, 1.6));
    gl.uniform1f(U.uZoom, (1 + 0.08 * read) * (1 - 0.45 * w));
    gl.uniform1f(U.uGlow, glow + flare * 1.6);
    gl.uniform1f(U.uWarp, w);
    gl.uniform1f(U.uTilt, (L.tilt || 0.12) + 0.02 * Math.sin(t * 0.05));
    gl.uniform1f(U.uRoll, L.roll || 0);
    gl.uniform1f(U.uYaw, t * 0.012);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    if (!reduced && !warp) {   // adaptive quality after the warp
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
    glowTarget = 0.9 + 0.3 * Math.max(chapterFraction(), complete() ? 1 : 0);
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
    if (now && !wasComplete) { flare = 1; if (reduced) redraw(); }   // just finished: it flares
    wasComplete = now;
  });
  resize(); update(); read = readTarget; glow = glowTarget; redraw();

  // No WebGL: a still star field with a soft glow so the page keeps its mood.
  function fallback() {
    var g = canvas.getContext("2d");
    if (!g) return;
    function draw() {
      var w = canvas.width = innerWidth, h = canvas.height = innerHeight;
      g.fillStyle = "#040406"; g.fillRect(0, 0, w, h);
      for (var i = 0; i < 320; i++) { var a = Math.random(); g.fillStyle = "rgba(235,225,210," + (a * a * 0.8).toFixed(2) + ")"; g.fillRect(Math.random() * w, Math.random() * h, 1.2, 1.2); }
      var cx = w * 0.82, cy = h * 0.28, R = Math.min(w, h) * 0.07;
      var halo = g.createRadialGradient(cx, cy, R * 0.9, cx, cy, R * 3);
      halo.addColorStop(0, "rgba(255,190,110,.5)"); halo.addColorStop(0.3, "rgba(230,130,50,.18)"); halo.addColorStop(1, "rgba(0,0,0,0)");
      g.fillStyle = halo; g.beginPath(); g.arc(cx, cy, R * 3, 0, 6.283); g.fill();
      g.fillStyle = "#000"; g.beginPath(); g.arc(cx, cy, R, 0, 6.283); g.fill();
    }
    draw();
    window.addEventListener("resize", draw);
  }
})();
