/* BLACKBOX reading-page background: every chapter looks out onto a different corner of space.
     0  a distant black hole — ray-traced: light bends round it, the accretion disk is brighter on
        the side spinning towards you, fine orbital streaks, stars lensed near its shadow
     1  the same kind of hole seen edge-on, disk slicing across the sky
     2  Earth from low orbit — blue atmosphere on the limb, city lights on the night side
     3  Mars — rust-red, cratered, lit from the side
     4  a golden spiral galaxy
   Built for quality and speed: the scene is ray-traced ONCE, at full screen resolution (supersampled
   up to 4K), in small strips spread over a few frames so the page never stutters, then fades in.
   After that nothing is re-rendered: the only motion is a slow camera drift (a CSS transform on the
   GPU), a few twinkling stars and the odd shooting star on a tiny overlay canvas. */
(function () {
  "use strict";
  var layout = document.querySelector(".lesson-layout");
  if (!layout) return;

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
  var reduced = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;

  // stage: wrapper (reading drift + completion flare) > drifter (slow camera drift) > canvases
  var stage = document.createElement("div");
  stage.className = "ambient-bg"; stage.setAttribute("aria-hidden", "true");
  stage.innerHTML = '<div class="amb-drift"><canvas class="amb-scene"></canvas></div><canvas class="amb-twinkle"></canvas>';
  document.body.insertBefore(stage, document.body.firstChild);
  document.body.classList.add("ambient-on");
  var canvas = stage.querySelector(".amb-scene"), tw = stage.querySelector(".amb-twinkle");
  var cap = document.createElement("div");
  cap.className = "ambient-caption"; cap.setAttribute("aria-hidden", "true");
  cap.innerHTML = "<b>" + SCENES[scene].name + "</b><span>" + SCENES[scene].sub + "</span>";
  (document.querySelector(".lesson-main") || document.body).appendChild(cap);

  var gl = null;
  try { gl = canvas.getContext("webgl", { antialias: false, alpha: false, depth: false, preserveDrawingBuffer: true, powerPreference: "high-performance" }) || canvas.getContext("experimental-webgl", { preserveDrawingBuffer: true }); } catch (e) {}

  var VS = "attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}";
  var FS = [
    "precision highp float;",
    "uniform vec2 uRes,uCenter;uniform float uDist,uTilt,uYaw,uScene,uRoll,uWide,uPx;",
    "float h21(vec2 p){p=fract(p*vec2(123.34,456.21));p+=dot(p,p+45.32);return fract(p.x*p.y);}",
    "float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);",
    " return mix(mix(h21(i),h21(i+vec2(1,0)),f.x),mix(h21(i+vec2(0,1)),h21(i+vec2(1,1)),f.x),f.y);}",
    "float fbm(vec2 p){float v=0.,a=.5;for(int i=0;i<6;i++){v+=a*noise(p);p=p*2.03+vec2(1.7,9.2);a*=.5;}return v;}",
    "mat2 rot(float a){float c=cos(a),s=sin(a);return mat2(c,-s,s,c);}",
    // stars (crisp cores, soft halo on the bright ones) + milky way
    "vec3 sky(vec3 d){",
    " vec2 sp=vec2(atan(d.z,d.x),asin(clamp(d.y,-1.,1.)));vec3 c=vec3(0.);",
    " for(int L=0;L<4;L++){float sc=L==0?60.:L==1?140.:L==2?300.:620.;vec2 g=sp*sc;vec2 id=floor(g),f=fract(g)-.5;",
    "  float h=h21(id+float(L)*17.);float th=L==0?.972:L==1?.968:L==2?.955:.93;",
    "  if(h>th){vec2 o=vec2(h21(id+3.),h21(id+7.))-.5;float s=length(f-o*.7)/sc/uPx;",   // distance in pixels
    "   float b=pow((h-th)/(1.-th),2.);float core=exp(-s*s*.3);float halo=L==0?exp(-s*s*.02)*.18:0.;",
    "   vec3 tint=mix(vec3(1.,.84,.66),vec3(.7,.8,1.),h21(id+11.));",
    "   c+=tint*b*(core+halo)*(L==0?2.4:L==1?1.2:L==2?.7:.35);}}",
    " vec2 q=rot(.5)*sp;float band=exp(-q.y*q.y*8.);",
    " float dust=fbm(q*vec2(3.,7.)+2.);float lane=smoothstep(.42,.78,fbm(q*vec2(6.,15.)+8.));",
    " c+=band*(vec3(.42,.36,.48)*pow(dust,2.2)*.34*(1.-.75*lane)+vec3(.95,.78,.62)*pow(noise(q*500.),16.)*.9);",
    " return c;}",
    // ── black hole (ray traced) ──
    "vec3 blackhole(vec2 uv){",
    " vec3 cam=vec3(sin(uYaw)*cos(uTilt),sin(uTilt),-cos(uYaw)*cos(uTilt))*uDist;",
    " vec3 fw=normalize(-cam),rt=normalize(cross(vec3(0,1,0),fw)),up=cross(fw,rt);",
    " vec3 dir=normalize(fw*1.35+uv.x*rt+uv.y*up);",
    " if(length(uv)>30./uDist)return sky(dir);",   // far from the hole light barely bends
    " vec3 pos=cam,vel=dir;vec3 hv=cross(pos,vel);float h2=dot(hv,hv);",
    " vec3 col=vec3(0.);float alpha=0.,glow=0.;bool captured=false;",
    " for(int i=0;i<320;i++){",
    "  float r=length(pos);float dt=clamp(.07*r-.1,.02,2.4);",
    "  vec3 np=pos+vel*dt;vel+=-1.5*h2*pos/pow(r,5.)*dt;",
    "  glow+=exp(-(r-1.55)*(r-1.55)*9.)*dt*.03;",
    "  if(pos.y*np.y<0.){",
    "   vec3 hit=mix(pos,np,pos.y/(pos.y-np.y));float rr=length(hit.xz);",
    "   if(rr>2.4&&rr<17.){",
    "    float ang=atan(hit.z,hit.x)+1.3/pow(rr,1.5);",
    "    float n=fbm(vec2(rr*2.2,ang*4.))*.55+fbm(vec2(rr*10.,ang*20.))*.3;",
    "    float streak=pow(noise(vec2(rr*55.,ang*1.2)),2.)*.5+pow(noise(vec2(rr*140.,ang*.8)),4.)*.6;",   // thin orbital strands
    "    float inten=pow(3./rr,2.2)*smoothstep(2.4,3.2,rr)*(1.-smoothstep(11.,17.,rr));",
    "    vec3 dv=normalize(vec3(-hit.z,0.,hit.x));float beam=clamp(1.+.5*dot(dv,-normalize(vel)),.35,1.6);",
    "    float temp=clamp(inten*1.15*beam,0.,1.);",
    "    vec3 c=mix(vec3(.8,.28,.06),vec3(1.,.78,.5),temp);c=mix(c,vec3(1.,.96,.88),smoothstep(.78,1.,temp));",
    "    float dens=.3+n+streak;float op=clamp(inten*dens*1.1,0.,.96);",
    "    col+=(1.-alpha)*c*dens*inten*beam*3.2;alpha+=(1.-alpha)*op;",
    "    if(alpha>.98)break;}}",
    "  pos=np;",
    "  if(r<1.){captured=true;break;}",
    "  if(r>uDist*1.3&&dot(pos,vel)>0.)break;",
    " }",
    " if(!captured)col+=(1.-alpha)*sky(normalize(vel));",
    " return col+vec3(1.,.72,.42)*glow*2.;}",
    // ── a lit sphere (planets) ──
    "vec3 planet(vec2 uv,vec2 c,float R,vec3 L,int kind,out float cover){",
    " vec2 p=(uv-c)/R;float r=length(p);cover=0.;vec3 col=vec3(0.);L=normalize(L);",
    " vec3 atm=kind==0?vec3(.25,.55,1.):vec3(1.,.55,.3);",
    " float sunSide=clamp(dot(normalize(vec3(p,.0001)),L)*.5+.5,0.,1.);",
    " float aa=uPx*1.4/R*2.;",
    " if(r>1.){float a=exp(-(r-1.)*(kind==0?14.:30.));col+=atm*a*(.3+1.6*pow(sunSide,3.))*(kind==0?1.2:.45);return col;}",
    " cover=smoothstep(1.,1.-aa,r);",
    " vec3 n=vec3(p,sqrt(max(0.,1.-r*r)));float lit=dot(n,L);",
    " float lon=atan(n.x,n.z)+.4,lat=asin(clamp(n.y,-1.,1.));vec2 m=vec2(lon,lat);",
    " float day=smoothstep(-.08,.25,lit);",
    " if(kind==0){",
    "  float land=smoothstep(.5,.56,fbm(m*2.6+1.3));",
    "  vec3 surf=mix(vec3(.02,.07,.2),mix(vec3(.12,.2,.1),vec3(.35,.3,.2),fbm(m*9.)),land);",
    "  float cloud=smoothstep(.55,.82,fbm(m*4.2+vec2(3.,0.)));surf=mix(surf,vec3(.88),cloud*.65);",
    "  vec3 hvec=normalize(L+vec3(0,0,1));float spec=pow(max(dot(n,hvec),0.),60.)*(1.-land)*(1.-cloud)*.6;",
    "  col=surf*(max(lit,0.)*1.4+.035)+vec3(.02,.05,.12)*(1.-day)+vec3(1.,.9,.7)*spec;",
    "  float city=(pow(noise(m*90.),5.)*.8+pow(noise(m*260.),9.)+pow(noise(m*600.),14.)*1.2)*land*(1.-cloud*.8)*(1.-day)*smoothstep(.4,.62,fbm(m*7.))*14.;",
    "  col+=vec3(1.,.72,.35)*city;",
    " }else{",
    "  float h=fbm(m*3.+4.),cr=fbm(m*16.),fine=fbm(m*48.);",
    "  vec3 surf=mix(vec3(.5,.16,.06),vec3(.82,.4,.19),h);surf*=.72+.4*cr+.2*fine;",
    "  surf=mix(surf,vec3(.82,.78,.74),smoothstep(.93,.97,n.y+.03*noise(m*20.)));",
    "  col=surf*(pow(max(lit,0.),1.2)*.95+.015);",
    " }",
    " float rim=pow(1.-n.z,3.);col+=atm*rim*(kind==0?.9:.18)*(.2+day);",
    " return col;}",
    // ── spiral galaxy ──
    "vec3 galaxy(vec2 uv){",
    " vec2 p=rot(-.45)*(uv-uCenter);p.y*=2.6;float r=length(p);float a=atan(p.y,p.x);",
    " float s=a+log(r+.02)*2.4;",
    " float arms=pow(.5+.5*cos(s*2.),2.5);",
    " float dust=fbm(vec2(s*1.6,r*7.)),fine=fbm(vec2(s*5.,r*24.));",
    " float b=arms*(.35+dust)*(.6+fine)*exp(-r*2.)*1.4+exp(-r*r*40.)*2.2+exp(-r*5.)*.25;",
    " float lanes=smoothstep(.55,.8,fbm(vec2(s*3.,r*12.)+5.))*arms;",
    " vec3 c=mix(vec3(1.,.55,.15),vec3(1.,.9,.7),clamp(exp(-r*4.),0.,1.))*b*(1.-.6*lanes);",
    " c+=vec3(1.,.8,.55)*pow(noise(p*260.),22.)*arms*exp(-r*1.5)*3.;",
    " return c;}",
    "void main(){",
    " vec2 uv=(gl_FragCoord.xy-.5*uRes)/uRes.y;",
    " vec3 dir=normalize(vec3(uv*rot(.1),1.4));",
    " vec3 col;int sc=int(uScene+.5);",
    " if(sc<=1){vec2 b=(uv-uCenter)*rot(uRoll);col=blackhole(b);}",
    " else if(sc==2){float cv;vec3 base=sky(dir);vec3 pl=planet(uv,uCenter,1.05,vec3(-.1,.95,.25),0,cv);col=base*(1.-cv)+pl;}",
    " else if(sc==3){float cv;vec3 base=sky(dir);vec3 pl=planet(uv,uCenter,uWide>.5?.5:.36,vec3(-.8,.35,.45),1,cv);col=base*(1.-cv)+pl;}",
    " else{col=sky(dir)+galaxy(uv);}",
    " col=1.-exp(-col*1.35);col=pow(col,vec3(.92));",
    " vec2 q=gl_FragCoord.xy/uRes;col*=.4+.6*pow(16.*q.x*q.y*(1.-q.x)*(1.-q.y),.16);",
    " col+=(h21(gl_FragCoord.xy)-.5)/255.;",   // dither: no banding in the dark gradients
    " gl_FragColor=vec4(col,1.);}"
  ].join("\n");

  // Where each scene sits: in the open space around the reading column, never under all of it.
  function layoutFor(wide, aspect) {
    var edge = aspect / 2;
    switch (scene) {
      case 0: return wide ? { c: [edge - 0.3, 0.2], dist: 58, tilt: 0.16, roll: 0.12 } : { c: [0.12, 0.3], dist: 70, tilt: 0.16, roll: 0.1 };
      case 1: return wide ? { c: [-edge + 0.45, -0.12], dist: 50, tilt: 0.035, roll: -0.42 } : { c: [0.0, 0.22], dist: 62, tilt: 0.035, roll: -0.4 };
      case 2: return { c: [0.0, wide ? -1.2 : -1.12] };
      case 3: return wide ? { c: [edge - 0.2, -0.36] } : { c: [0.26, 0.32] };
      default: return wide ? { c: [edge - 0.45, 0.2] } : { c: [0.05, 0.28] };
    }
  }

  // ── render the scene once, in strips ──
  var prog = gl && build();
  var job = 0, lastSize = "";
  function build() {
    function sh(type, src) {
      var s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { if (window.console) console.warn(gl.getShaderInfoLog(s)); return null; }
      return s;
    }
    var vs = sh(gl.VERTEX_SHADER, VS), fs = sh(gl.FRAGMENT_SHADER, FS);
    if (!vs || !fs) return null;
    var p = gl.createProgram();
    gl.attachShader(p, vs); gl.attachShader(p, fs); gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) return null;
    gl.useProgram(p);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    var loc = gl.getAttribLocation(p, "p");
    gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    return p;
  }
  function render() {
    var cssW = window.innerWidth, cssH = window.innerHeight;
    // Supersample normal screens (1.5x), use the real density on HiDPI, cap at ~4K worth of pixels.
    var q = Math.min(2, Math.max(window.devicePixelRatio || 1, 1.5));
    var max = 3840 * 2160, px = cssW * cssH * q * q;
    if (px > max) q *= Math.sqrt(max / px);
    var W = Math.round(cssW * q), H = Math.round(cssH * q);
    lastSize = cssW + "x" + cssH;
    canvas.width = W; canvas.height = H;
    gl.viewport(0, 0, W, H);
    var U = function (n) { return gl.getUniformLocation(prog, n); };
    var wide = cssW >= 1000, L = layoutFor(wide, W / H);
    gl.uniform2f(U("uRes"), W, H);
    gl.uniform2f(U("uCenter"), L.c[0], L.c[1]);
    gl.uniform1f(U("uScene"), scene);
    gl.uniform1f(U("uWide"), wide ? 1 : 0);
    gl.uniform1f(U("uDist"), L.dist || 60);
    gl.uniform1f(U("uTilt"), L.tilt || 0.12);
    gl.uniform1f(U("uRoll"), L.roll || 0);
    gl.uniform1f(U("uYaw"), 0.35);
    gl.uniform1f(U("uPx"), 1 / (1.4 * H));   // one pixel as an angle, so stars stay pixel-sharp at any size
    gl.enable(gl.SCISSOR_TEST);
    var my = ++job, strip = Math.max(16, Math.floor(450000 / W)), y = 0;
    canvas.classList.remove("ready");
    (function next() {
      if (my !== job) return;
      gl.scissor(0, y, W, Math.min(strip, H - y));
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      y += strip;
      if (y < H) requestAnimationFrame(next);
      else { gl.disable(gl.SCISSOR_TEST); canvas.classList.add("ready"); }
    })();
  }

  if (prog) render(); else fallback();

  var rt = 0;
  window.addEventListener("resize", function () {
    clearTimeout(rt);
    rt = setTimeout(function () {
      var o = lastSize.split("x").map(Number);
      // ignore small height-only changes (mobile address bar); the CSS stretch covers them
      if (Math.abs(innerWidth - o[0]) < 2 && Math.abs(innerHeight - o[1]) / o[1] < 0.2) return;
      if (prog) render(); else fallback();
      sizeTwinkle();
    }, 250);
  });

  // ── little motion: twinkling stars + an occasional shooting star (tiny 2D canvas, ~20 fps) ──
  var tctx = tw.getContext("2d"), stars = [], shoot = null, lastT = 0, traf = 0;
  var nextShoot = performance.now() + 9000 + Math.random() * 12000;
  function sizeTwinkle() {
    if (!tctx) return;
    var d = Math.min(2, window.devicePixelRatio || 1);
    tw.width = Math.round(innerWidth * d); tw.height = Math.round(innerHeight * d);
    tctx.setTransform(d, 0, 0, d, 0, 0);
    stars = [];
    var n = Math.round(innerWidth * innerHeight / 22000);
    for (var i = 0; i < n; i++) stars.push({ x: Math.random() * innerWidth, y: Math.random() * innerHeight, r: 0.5 + Math.random() * 0.9, p: Math.random() * 6.28, s: 0.4 + Math.random() * 1.2, warm: Math.random() < 0.5 });
  }
  function twinkle(now) {
    traf = 0;
    if (now - lastT >= 50) {
      lastT = now;
      var t = now / 1000;
      tctx.clearRect(0, 0, innerWidth, innerHeight);
      for (var i = 0; i < stars.length; i++) {
        var s = stars[i], a = Math.pow(0.5 + 0.5 * Math.sin(t * s.s + s.p), 3) * 0.85;
        if (a < 0.03) continue;
        tctx.fillStyle = s.warm ? "rgba(255,226,190," + a.toFixed(3) + ")" : "rgba(210,225,255," + a.toFixed(3) + ")";
        tctx.beginPath(); tctx.arc(s.x, s.y, s.r, 0, 6.283); tctx.fill();
      }
      if (!shoot && now > nextShoot) {
        var ang = 0.35 + Math.random() * 0.4;
        shoot = { x: Math.random() * innerWidth * 0.8, y: Math.random() * innerHeight * 0.4, vx: Math.cos(ang), vy: Math.sin(ang), t0: now };
      }
      if (shoot) {
        var k = (now - shoot.t0) / 1000;
        if (k > 0.9) { shoot = null; nextShoot = now + 14000 + Math.random() * 20000; }
        else {
          var x = shoot.x + shoot.vx * 900 * k, y = shoot.y + shoot.vy * 900 * k, fade = Math.sin(k / 0.9 * Math.PI), len = 90;
          var g = tctx.createLinearGradient(x, y, x - shoot.vx * len, y - shoot.vy * len);
          g.addColorStop(0, "rgba(255,245,230," + (0.9 * fade).toFixed(3) + ")"); g.addColorStop(1, "rgba(255,245,230,0)");
          tctx.strokeStyle = g; tctx.lineWidth = 1.4;
          tctx.beginPath(); tctx.moveTo(x, y); tctx.lineTo(x - shoot.vx * len, y - shoot.vy * len); tctx.stroke();
        }
      }
    }
    if (!document.hidden) traf = requestAnimationFrame(twinkle);
  }
  if (!reduced && tctx) {
    sizeTwinkle(); traf = requestAnimationFrame(twinkle);
    document.addEventListener("visibilitychange", function () { if (!document.hidden && !traf) traf = requestAnimationFrame(twinkle); });
  } else tw.remove();

  // ── reading progress: drift a touch closer; finishing makes the scene flare ──
  function readProgress() {
    var m = document.documentElement.scrollHeight - innerHeight;
    return m > 0 ? Math.min(1, Math.max(0, scrollY / m)) : 0;
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
  var ticking = false;
  function update() {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(function () {
      ticking = false;
      stage.style.setProperty("--read", (complete() ? 1 : Math.max(readProgress(), chapterFraction())).toFixed(3));
    });
  }
  var wasComplete = complete();
  window.addEventListener("scroll", update, { passive: true });
  if (window.BB && BB.on) BB.on(function (w) {
    if (w !== "progress") return;
    update();
    var now = complete();
    if (now && !wasComplete && !reduced) { stage.classList.remove("flare"); void stage.offsetWidth; stage.classList.add("flare"); }
    wasComplete = now;
  });
  update();

  // No WebGL: a still star field with a soft glow so the page keeps its mood.
  function fallback() {
    var g = canvas.getContext("2d");
    if (!g) return;
    var w = canvas.width = innerWidth, h = canvas.height = innerHeight;
    lastSize = w + "x" + h;
    g.fillStyle = "#040406"; g.fillRect(0, 0, w, h);
    for (var i = 0; i < 360; i++) { var a = Math.random(); g.fillStyle = "rgba(235,225,210," + (a * a * 0.8).toFixed(2) + ")"; g.fillRect(Math.random() * w, Math.random() * h, 1.2, 1.2); }
    var cx = w * 0.82, cy = h * 0.28, R = Math.min(w, h) * 0.07;
    var halo = g.createRadialGradient(cx, cy, R * 0.9, cx, cy, R * 3);
    halo.addColorStop(0, "rgba(255,190,110,.5)"); halo.addColorStop(0.3, "rgba(230,130,50,.18)"); halo.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = halo; g.beginPath(); g.arc(cx, cy, R * 3, 0, 6.283); g.fill();
    g.fillStyle = "#000"; g.beginPath(); g.arc(cx, cy, R, 0, 6.283); g.fill();
    canvas.classList.add("ready");
  }
})();
