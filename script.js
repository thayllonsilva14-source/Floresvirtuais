/* ==========================================================
   JARDIM ANIMADO - SCRIPT (versão otimizada)

   O que mudou em relação à versão anterior:
   - Cada planta, arbusto e tufo de capim é um SVG pequeno e
     independente (camada própria). O balanço vira transform
     de camada inteira e roda na GPU, sem repintar nada.
   - Estrelas e partículas viram canvas: 2 elementos em vez de
     ~140 divs animadas. Sprites são pré-desenhados uma vez.
   - Corações são criados uma única vez e apenas reciclados.
   - Um único requestAnimationFrame cuida de tudo.
   - Detecção automática de aparelho lento (modo leve).
   ========================================================== */
(() => {
  'use strict';

  /* ---------- CONFIGURAÇÕES (edite à vontade) ---------- */
  const CFG = {
    modo: 'auto',           // 'auto' = decide sozinho | 'leve' = força leve | 'completo' = força tudo
    baseY: 860,             // altura do chão no mundo (600x900)
    cicloMs: 34000,         // tempo até as flores sumirem e nascerem de novo
    estrelas: 90,           // pontinhos de luz do fundo
    particulas: 46,         // partículas verdes/amareladas
    coracoes: 13,           // corações flutuando
    capimFundo: 40,         // densidade do capim escuro (atrás)
    capimFrente: 38,        // densidade do capim brilhante (frente)
    fatorCelular: 0.65,     // celulares usam esta fração de estrelas/partículas
    fpsMinimo: 46,          // abaixo disso nos 6 primeiros segundos => modo leve
  };

  /* Flores (7 no total):  base, 2 pontos de curva, posição da flor,
     tamanho (s), inclinação (tilt), balanço (sway) e atraso (d) */
  const FLORES = [
    { base: [296, 862], c1: [286, 650], c2: [312, 430], head: [300, 250], s: 1.00, tilt: 4,   sway: 1.3, d: 0.3 },
    { base: [288, 862], c1: [276, 720], c2: [214, 560], head: [200, 392], s: 1.18, tilt: -10, sway: 1.6, d: 0.0 },
    { base: [310, 862], c1: [330, 660], c2: [414, 520], head: [424, 352], s: 1.30, tilt: 12,  sway: 1.5, d: 0.5 },
    { base: [272, 862], c1: [252, 760], c2: [140, 640], head: [118, 482], s: 0.80, tilt: -16, sway: 1.9, d: 0.9 },
    { base: [328, 862], c1: [350, 770], c2: [458, 650], head: [478, 520], s: 0.74, tilt: 14,  sway: 2.0, d: 1.2 },
    { base: [302, 862], c1: [312, 740], c2: [345, 600], head: [352, 468], s: 0.90, tilt: 6,   sway: 1.7, d: 0.7 },
    { base: [270, 862], c1: [238, 700], c2: [150, 520], head: [132, 322], s: 0.92, tilt: -8,  sway: 1.8, d: 1.05 },
  ];

  /* ---------- AUXILIARES ---------- */
  const NS = 'http://www.w3.org/2000/svg';
  const TAU = Math.PI * 2;
  const rand = (a, b) => a + Math.random() * (b - a);
  const $ = (id) => document.getElementById(id);

  function svg(tag, attrs, parent) {
    const e = document.createElementNS(NS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }
  const place = (parent, x, y, ang = 0) =>
    svg('g', { transform: `translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(${ang.toFixed(1)})` }, parent);

  function vars(e, o) { for (const k in o) e.style.setProperty('--' + k, o[k]); return e; }

  // Ponto e direção de uma curva de Bézier cúbica
  function bez(p0, p1, p2, p3, t) {
    const u = 1 - t;
    const x = u*u*u*p0[0] + 3*u*u*t*p1[0] + 3*u*t*t*p2[0] + t*t*t*p3[0];
    const y = u*u*u*p0[1] + 3*u*u*t*p1[1] + 3*u*t*t*p2[1] + t*t*t*p3[1];
    const dx = 3*u*u*(p1[0]-p0[0]) + 6*u*t*(p2[0]-p1[0]) + 3*t*t*(p3[0]-p2[0]);
    const dy = 3*u*u*(p1[1]-p0[1]) + 6*u*t*(p2[1]-p1[1]) + 3*t*t*(p3[1]-p2[1]);
    return { x, y, ang: Math.atan2(dy, dx) * 180 / Math.PI };
  }

  /* Cria um SVG pequeno (uma camada) cobrindo a caixa `box` do mundo.
     Tudo dentro usa as MESMAS coordenadas do mundo (o <g> compensa). */
  function criarCamada(parent, box, classe) {
    const w = Math.ceil(box.w), h = Math.ceil(box.h);
    const s = svg('svg', { width: w, height: h, viewBox: `0 0 ${w} ${h}`, class: 'layer ' + classe }, parent);
    s.style.left = Math.floor(box.x) + 'px';
    s.style.top = Math.floor(box.y) + 'px';
    const g = svg('g', { transform: `translate(${-Math.floor(box.x)} ${-Math.floor(box.y)})` }, s);
    return { s, g, ox: Math.floor(box.x), oy: Math.floor(box.y), w, h };
  }

  /* ---------- FORMAS ---------- */
  const FOLHA_FINA = 'M0 0 C8 -13 32 -15 50 0 C32 13 8 11 0 0Z';
  const FOLHA_REDONDA = 'M0 0 C12 -22 52 -26 70 0 C52 26 12 22 0 0Z';
  const PETALA = 'M0 0 C-17 -6 -20 -32 0 -37 C20 -32 17 -6 0 0Z';
  const CORACAO = 'M12 21 C4 14 0 10 0 6 C0 2.5 3 0 6 0 C8.5 0 10.8 1.4 12 3.6 C13.2 1.4 15.5 0 18 0 C21 0 24 2.5 24 6 C24 10 20 14 12 21Z';

  /* ---------- ESTADO GLOBAL ---------- */
  const est = {
    W: innerWidth, H: innerHeight, k: 1, xmin: 0, xmax: 600,
    leve: false, capimDe: 1e9, capimAte: -1e9,
    toque: matchMedia('(pointer: coarse)').matches,
  };
  const dprMax = () => Math.min(devicePixelRatio || 1, est.leve ? 1 : 1.5);

  /* ==========================================================
     FLORES: cada planta = 1 camada (caule + folhas + cabeça)
     ========================================================== */
  function limitesDaFlor(f) {
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    for (let i = 0; i <= 10; i++) {
      const p = bez(f.base, f.c1, f.c2, f.head, i / 10);
      x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x);
      y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y);
    }
    const m = 125;                                   // folga p/ folhas, pétalas e brilho
    return { x: x0 - m, y: y0 - m, w: x1 - x0 + 2 * m, h: y1 - y0 + m + 10 };
  }

  function criarFlor(f, parent) {
    const [x0, y0] = f.base;
    const dur = 2.6;

    const L = criarCamada(parent, limitesDaFlor(f), 'plant');
    L.s.style.transformOrigin = `${x0 - L.ox}px ${y0 - L.oy}px`;     // balança presa na base
    const sd = rand(6, 9);
    vars(L.s, { a: (f.sway * rand(.8, 1.2)).toFixed(2) + 'deg', sd: sd.toFixed(1) + 's', sdl: (-rand(0, 8)).toFixed(1) + 's',
                sd2: (sd * rand(1.35, 1.9)).toFixed(1) + 's', sdl2: (-rand(0, 14)).toFixed(1) + 's', b: rand(.4, .8).toFixed(2) + 'deg' });   // 2º movimento: curvatura do caule, em ritmo próprio
    const planta = L.g;

    // caule: traço escuro + realce claro fino
    const d = `M${x0} ${y0} C${f.c1[0]} ${f.c1[1]} ${f.c2[0]} ${f.c2[1]} ${f.head[0]} ${f.head[1]}`;
    const vD = { d: f.d + 's', dur: dur + 's' };
    vars(svg('path', { class: 'stem', d, pathLength: 1, fill: 'none', stroke: '#2f9e3a', 'stroke-width': 6.5, 'stroke-linecap': 'round' }, planta), vD);
    vars(svg('path', { class: 'stem', d, pathLength: 1, fill: 'none', stroke: '#9bff74', 'stroke-width': 1.9, 'stroke-linecap': 'round', opacity: .8 }, planta), vD);

    // folhas ao longo do caule, alternando os lados
    const n = Math.round(5 + f.s * 3);
    for (let i = 0; i < n; i++) {
      const t = .3 + (i / n) * .55;   // folhas começam mais acima da base
      const p = bez(f.base, f.c1, f.c2, f.head, t);
      const lado = i % 2 ? 1 : -1;
      const g = place(planta, p.x, p.y, p.ang + lado * rand(42, 68));
      const s = rand(.7, 1.3) * (1.15 - t * .5);
      const atraso = f.d + t * dur * .85 + rand(0, .3);
      const fl = svg('g', { class: 'flutter' }, g);
      vars(fl, { a: rand(2, 5).toFixed(1) + 'deg', sd: rand(4, 7).toFixed(1) + 's', sdl: (-rand(0, 6)).toFixed(1) + 's' });
      const pop = svg('g', { class: 'pop' }, fl);
      vars(pop, { d: atraso.toFixed(2) + 's' });
      const fg = svg('g', { transform: `scale(${s.toFixed(2)})` }, pop);
      svg('path', { d: FOLHA_FINA, fill: 'url(#gLeaf)' }, fg);
      svg('path', { d: 'M2 0 L40 0', stroke: 'rgba(255,255,255,.28)', 'stroke-width': .9, fill: 'none', 'stroke-linecap': 'round' }, fg);
    }

    // cabeça da flor
    const cabeca = place(planta, f.head[0], f.head[1]);
    const hs = svg('g', { class: 'hsway' }, cabeca);
    vars(hs, { sd: rand(4, 6.5).toFixed(1) + 's', sdl: (-rand(0, 6)).toFixed(1) + 's', ha: rand(3.5, 6).toFixed(1) + 'deg' });
    const hp = svg('g', { class: 'pop' }, hs);
    const t0 = f.d + dur * .92;                      // nasce quando o caule termina
    vars(hp, { d: t0.toFixed(2) + 's' });
    const k = f.s * 1.3;
    const corpo = svg('g', { transform: `rotate(${f.tilt}) scale(${k.toFixed(2)} ${(k * .86).toFixed(2)})` }, hp);

    svg('circle', { r: 62, cy: -8, fill: 'url(#gGlow)' }, corpo);   // brilho (estático = barato)

    // pétalas: [ângulo, escala, mais escura?] - de trás para frente
    const petalas = [[-128, .95, 1], [-52, .95, 1], [-90, 1.08, 0], [-168, .9, 0], [-12, .9, 0], [62, .9, 0], [118, .9, 0]];
    petalas.forEach(([ang, esc, escura], i) => {
      const g = svg('g', { transform: `rotate(${ang})` }, corpo);
      const pp = svg('g', { class: 'pop petal' }, g);
      vars(pp, { d: (t0 + .25 + i * .13).toFixed(2) + 's' });
      svg('path', { d: PETALA, transform: `scale(${esc})`, fill: 'url(#gPetal)', opacity: escura ? .88 : 1 }, pp);
    });

    // miolo claro + arco branco
    const miolo = svg('g', { class: 'pop' }, corpo);
    vars(miolo, { d: (t0 + .9).toFixed(2) + 's' });
    svg('ellipse', { cx: 0, cy: 2, rx: 14, ry: 8, fill: '#ffd9ee' }, miolo);
    svg('path', { d: 'M-14 4 Q0 15 14 4', fill: 'none', stroke: '#fff0f8', 'stroke-width': 2.6, 'stroke-linecap': 'round', opacity: .92 }, miolo);
    svg('circle', { cx: 0, cy: -3, r: 2.4, fill: '#8fd44a' }, miolo);
  }

  /* ==========================================================
     ARBUSTO: 3 leques de folhas, cada leque = 1 camada que balança
     ========================================================== */
  function criarArbusto(parent) {
    const grupos = [
      { cx: 175, n: 19, de: -178, ate: -40, esc: [.9, 1.8] },
      { cx: 420, n: 18, de: -140, ate: -2,  esc: [.9, 1.8] },
      { cx: 300, n: 6,  de: -150, ate: -30, esc: [.7, 1.2] },
    ];
    grupos.forEach((gr) => {
      const alc = 70 * gr.esc[1];                    // alcance da maior folha
      const L = criarCamada(parent, {
        x: gr.cx - 55 - alc - 14, y: CFG.baseY - alc - 30,
        w: 2 * (55 + alc + 14),   h: alc + 80,
      }, 'bsway');
      L.s.style.transformOrigin = `${gr.cx - L.ox}px ${CFG.baseY - L.oy}px`;
      vars(L.s, { a: rand(.9, 1.5).toFixed(2) + 'deg', sd: rand(6, 8).toFixed(1) + 's', sdl: (-rand(0, 6)).toFixed(1) + 's',
                sd2: rand(9, 14).toFixed(1) + 's', sdl2: (-rand(0, 12)).toFixed(1) + 's', b: rand(.2, .4).toFixed(2) + 'deg' });

      for (let i = 0; i < gr.n; i++) {
        const g = place(L.g, gr.cx + rand(-55, 55), CFG.baseY + rand(-6, 10), rand(gr.de, gr.ate));
        const pop = svg('g', { class: 'pop' }, g);
        vars(pop, { d: rand(.8, 3.8).toFixed(2) + 's' });
        const fg = svg('g', { transform: `scale(${rand(gr.esc[0], gr.esc[1]).toFixed(2)})` }, pop);
        svg('path', { d: FOLHA_REDONDA, fill: 'url(#gLeafDark)', opacity: rand(.75, 1).toFixed(2) }, fg);
        svg('ellipse', { cx: 56, cy: 0, rx: 9, ry: 12, fill: 'rgba(130,255,120,.16)' }, fg);
        svg('path', { d: 'M4 0 L52 0', stroke: 'rgba(160,255,150,.18)', 'stroke-width': 1, fill: 'none' }, fg);
      }
    });
  }

  /* ==========================================================
     CAPIM: tufos de ~180 unidades, cada um = 1 camada.
     Só cria o capim da parte visível da tela (recria se a tela crescer).
     ========================================================== */
  function criarCapim(parent, qtd, frente, xmin, xmax) {
    const SP = 180;
    const porTufo = qtd / 2160 * SP;                 // mesma densidade da versão anterior
    for (let cx = Math.floor(xmin / SP) * SP; cx <= xmax + SP; cx += SP) {
      const n = Math.max(2, Math.round(porTufo * rand(.75, 1.25)));
      const folhas = [];
      let minX = 1e9, maxX = -1e9, maxH = 0;
      for (let i = 0; i < n; i++) {
        const off = rand(-SP / 2, SP / 2);
        const dist = Math.min(1, Math.abs(cx + off - 300) / 330);   // 0 no centro, 1 nas bordas
        const h = frente ? rand(50, 150) + dist * rand(40, 170) : rand(90, 220) + dist * rand(30, 120);
        const lean = rand(-70, 70) * (frente ? 1 : .6);
        const w = rand(2.4, 5.5), j = rand(0, 14);
        folhas.push({ off, h, lean, w, j });
        minX = Math.min(minX, off - w, off + lean); maxX = Math.max(maxX, off + w, off + lean);
        maxH = Math.max(maxH, h);
      }
      const pad = 6, H = Math.ceil(maxH + 18), W = Math.ceil(maxX - minX + 2 * pad);
      const left = cx + minX - pad;

      const wrap = document.createElement('div');
      wrap.className = 'gc rise';
      wrap.style.cssText = `left:${left.toFixed(0)}px;top:${CFG.baseY + 14 - H}px;`;
      vars(wrap, { d: rand(.2, 3.2).toFixed(2) + 's' });

      const s = svg('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}`, class: 'gsway', style: 'display:block;overflow:visible' }, wrap);
      s.style.transformOrigin = `${(cx - left).toFixed(0)}px ${H - 7}px`;
      vars(s, { a: rand(2, 5).toFixed(1) + 'deg', sd: rand(3.5, 7).toFixed(1) + 's', sdl: (-rand(0, 6)).toFixed(1) + 's',
                sd2: rand(6, 12).toFixed(1) + 's', sdl2: (-rand(0, 12)).toFixed(1) + 's', b: rand(1, 2).toFixed(1) + 'deg' });

      for (const b of folhas) {
        const x = b.off - minX + pad, y = H - 14 + b.j;
        const d = `M${(x - b.w).toFixed(1)} ${y.toFixed(1)} ` +
                  `Q${(x + b.lean * .3 - b.w * .5).toFixed(1)} ${(y - b.h * .6).toFixed(1)} ${(x + b.lean).toFixed(1)} ${(y - b.h).toFixed(1)} ` +
                  `Q${(x + b.lean * .5 + b.w * .6).toFixed(1)} ${(y - b.h * .5).toFixed(1)} ${(x + b.w).toFixed(1)} ${y.toFixed(1)}Z`;
        svg('path', { d, fill: 'url(#gGrass)', opacity: frente ? 1 : .5 }, s);
      }
      parent.appendChild(wrap);
    }
  }

  function montarCapim() {
    est.capimDe = est.xmin - 120; est.capimAte = est.xmax + 120;
    $('grassBack').textContent = ''; $('grassFront').textContent = '';
    criarCapim($('grassBack'), CFG.capimFundo, false, est.capimDe, est.capimAte);
    criarCapim($('grassFront'), CFG.capimFrente, true, est.capimDe, est.capimAte);
    // se o crescimento já estava ativo, as novas camadas também participam
    $('grassBack').classList.add('live'); $('grassFront').classList.add('live');
  }

  /* ==========================================================
     ESTRELAS (canvas, redesenhado ~12x por segundo)
     ========================================================== */
  const cvStars = $('stars'), ctxStars = cvStars.getContext('2d');
  let estrelas = [];

  function criarEstrelas() {
    const q = Math.round(CFG.estrelas * (est.toque ? CFG.fatorCelular : 1));
    estrelas = Array.from({ length: q }, () => ({
      x: rand(0, 1), y: rand(0, .88), r: rand(.5, 1.3), tw: rand(2.5, 7), ph: rand(0, TAU),
    }));
  }
  function desenharEstrelas(t) {
    const W = est.W, H = est.H;
    ctxStars.clearRect(0, 0, W, H);
    ctxStars.fillStyle = '#fff';
    for (const s of estrelas) {
      ctxStars.globalAlpha = .1 + .85 * (1 - Math.cos(TAU * t / s.tw + s.ph)) / 2;
      ctxStars.beginPath();
      ctxStars.arc(s.x * W, s.y * H, s.r, 0, TAU);
      ctxStars.fill();
    }
  }

  /* ==========================================================
     PARTÍCULAS (canvas + sprites pré-desenhados)
     ========================================================== */
  const cvSparks = $('sparks'), ctxSparks = cvSparks.getContext('2d');
  const CORES = ['#9dff6a', '#d8ff5a', '#ffe94a', '#7be86a', '#fff08a'];
  let sprites = [], sparks = [], sparksAtivas = 0;

  // Um "brilhinho" por cor: núcleo sólido + halo suave (desenhado uma vez)
  function criarSprites() {
    sprites = CORES.map((hex) => {
      const c = document.createElement('canvas'); c.width = c.height = 48;
      const g = c.getContext('2d');
      const rgb = [1, 3, 5].map((i) => parseInt(hex.substr(i, 2), 16)).join(',');
      const grad = g.createRadialGradient(24, 24, 0, 24, 24, 24);
      grad.addColorStop(0, `rgba(${rgb},1)`);
      grad.addColorStop(.26, `rgba(${rgb},1)`);
      grad.addColorStop(.32, `rgba(${rgb},.5)`);
      grad.addColorStop(1, `rgba(${rgb},0)`);
      g.fillStyle = grad; g.fillRect(0, 0, 48, 48);
      return c;
    });
  }
  function criarParticulas() {
    const q = Math.round(CFG.particulas * (est.toque ? CFG.fatorCelular : 1));
    sparks = Array.from({ length: q }, () => ({
      x: rand(.05, .95), y: rand(.08, .85), dx: rand(-70, 70), dy: rand(-110, 40),
      t: rand(8, 18), w: rand(5, 11), tw: rand(2.5, 6), ph: rand(0, TAU), ph2: rand(0, TAU),
      c: (Math.random() * CORES.length) | 0, r: rand(2, 5.5) * 2.1,
    }));
    sparksAtivas = sparks.length;
  }
  function desenharParticulas(t) {
    const W = est.W, H = est.H;
    ctxSparks.clearRect(0, 0, W, H);
    for (let i = 0; i < sparksAtivas; i++) {
      const s = sparks[i];
      const m = (1 - Math.cos(TAU * (t / (2 * s.t)) + s.ph)) / 2;               // vai-e-volta suave
      ctxSparks.globalAlpha = .1 + .85 * (1 - Math.cos(TAU * t / s.tw + s.ph2)) / 2;   // cintilar
      const w = TAU * t / s.w + s.ph2;                                             // ondulação lateral lenta
      ctxSparks.drawImage(sprites[s.c], s.x * W + s.dx * m + Math.sin(w) * 7 - s.r, s.y * H + s.dy * m + Math.cos(w) * 5 - s.r, s.r * 2, s.r * 2);
    }
  }

  /* ==========================================================
     CORAÇÕES: criados uma vez; ao sair pelo topo são só reciclados
     ========================================================== */
  const hearts = [];
  const CORES_CORACAO = ['#e8142c', '#ff2a3d'];   // tons de vermelho

  function renovarCoracao(h, inicial) {
    h.p = inicial ? Math.random() : 0;               // 0 = embaixo, 1 = topo
    h.x = rand(.04, .96);
    h.v = 1 / rand(38, 75);
    h.amp = rand(10, 34); h.f = rand(.4, 1); h.ph = rand(0, TAU);
    h.rot = rand(-14, 14); h.ph2 = rand(0, TAU);
    h.k = rand(14, 46) / 40;                         // tamanho = escala sobre a base de 40px
    h.op = -1;
    const el = h.el;
    el.classList.toggle('has-ring', Math.random() < .42);
    el.style.setProperty('--k', h.k.toFixed(2));
    el.style.setProperty('--hc', CORES_CORACAO[Math.random() < .5 ? 0 : 1]);
    el.style.setProperty('--pt', rand(2, 3.4).toFixed(1) + 's');
  }

  function criarCoracoes() {
    const fx = $('fx');
    const html = `<div class="ring"></div><svg viewBox="0 0 24 21"><path d="${CORACAO}"/></svg>`;
    for (let i = 0; i < CFG.coracoes; i++) {
      const el = document.createElement('div');
      el.className = 'heart';
      el.innerHTML = html;
      fx.appendChild(el);
      const h = { el };
      renovarCoracao(h, true);
      hearts.push(h);
    }
  }

  function moverCoracoes(dt, t) {
    const W = est.W, H = est.H;
    for (const h of hearts) {
      h.p += h.v * dt * (1 + .18 * Math.sin(t * .35 + h.ph2));     // sobe em ritmo levemente variável
      if (h.p >= 1) renovarCoracao(h, false);
      const a1 = t * h.f + h.ph;
      const x = h.x * W + (Math.sin(a1) + .35 * Math.sin(a1 * 2.3 + h.ph2)) * h.amp;   // vai-e-vem com 2 ondas
      const y = H * (1.04 - 1.1 * h.p);
      const rot = h.rot * .5 + Math.cos(a1) * 7;                                       // inclina para o lado em que vai
      h.el.style.transform = `translate3d(${x.toFixed(1)}px,${y.toFixed(1)}px,0) translate(-50%,-50%) rotate(${rot.toFixed(1)}deg) scale(${h.k.toFixed(2)})`;
      // opacidade só muda nas pontas (aparecendo/sumindo); no meio fica em 1
      const op = Math.min(1, h.p * 6, (1 - h.p) * 5);
      const o = op >= 1 ? 1 : Math.round(op * op * (3 - 2 * op) * 100) / 100;           // aparece/some em curva suave
      if (o !== h.op) { h.op = o; h.el.style.opacity = o; }
    }
  }

  /* ==========================================================
     ENQUADRAMENTO: o "mundo" 600x900 é escalado/posicionado para
     caber em qualquer tela (celular em pé ou computador deitado)
     ========================================================== */
  function ajustar() {
    const W = est.W = innerWidth, H = est.H = innerHeight;
    const k = est.k = (W / H > 520 / 900) ? H / 900 : W / 520;
    const tx = W / 2 - 300 * k, ty = H - 900 * k;
    $('world').style.transform = `translate(${tx}px,${ty}px) scale(${k})`;
    est.xmin = -tx / k; est.xmax = (W - tx) / k;

    const chao = $('ground');                        // chão cobre só a parte visível
    chao.style.left = (est.xmin - 40) + 'px';
    chao.style.width = (est.xmax - est.xmin + 80) + 'px';

    const dpr = dprMax();
    for (const c of [cvStars, cvSparks]) { c.width = Math.round(W * dpr); c.height = Math.round(H * dpr); }
    ctxStars.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctxSparks.setTransform(dpr, 0, 0, dpr, 0, 0);
    desenharEstrelas(tempo);

    // tela ficou mais larga que o capim criado: completa o capim
    if (est.capimAte > -1e9 && (est.xmin < est.capimDe || est.xmax > est.capimAte)) montarCapim();
  }

  /* ==========================================================
     MODO LEVE: menos partículas, folhas sem tremular sozinhas,
     animação limitada a 30 fps
     ========================================================== */
  function aplicarLeve() {
    if (est.leve) return;
    est.leve = true;
    document.body.classList.add('lite');
    sparksAtivas = Math.ceil(sparks.length * .5);
    ajustar();                                       // canvas com resolução menor
  }

  /* ==========================================================
     LOOP ÚNICO (requestAnimationFrame)
     ========================================================== */
  let tempo = 0;
  function iniciarLoop() {
    const inicio = performance.now();
    let ultimo = inicio, ultEstrelas = 0, frames = 0, medindo = CFG.modo === 'auto';
    document.addEventListener('visibilitychange', () => { medindo = false; ultimo = performance.now(); });

    (function frame(agora) {
      requestAnimationFrame(frame);
      const dtMs = agora - ultimo;

      // mede o FPS nos primeiros 6s (cobre o crescimento das flores)
      if (medindo) {
        frames++;
        if (agora - inicio > 6000) {
          medindo = false;
          if (frames / ((agora - inicio) / 1000) < CFG.fpsMinimo) aplicarLeve();
        }
      }
      if (est.leve && dtMs < 28) return;             // 30 fps no modo leve

      ultimo = agora;
      const dt = Math.min(.05, dtMs / 1000);
      tempo += dt;
      desenharParticulas(tempo);
      moverCoracoes(dt, tempo);
      if (agora - ultEstrelas > 90) { ultEstrelas = agora; desenharEstrelas(tempo); }
    })(inicio);
  }

  /* ==========================================================
     INÍCIO + CICLO (nasce -> fica vivo -> some -> nasce de novo)
     ========================================================== */
  function iniciar() {
    const fraco = (navigator.hardwareConcurrency || 8) <= 4 || (navigator.deviceMemory || 8) <= 3;
    criarSprites(); criarEstrelas(); criarParticulas();
    ajustar();                                       // calcula a área visível
    montarCapim();
    criarArbusto($('bush'));
    FLORES.forEach((f) => criarFlor(f, $('flowers')));
    criarCoracoes();

    if (CFG.modo === 'leve' || (CFG.modo === 'auto' && fraco)) aplicarLeve();

    let rt;
    addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(ajustar, 150); });

    ['bush', 'flowers'].forEach((id) => $(id).classList.add('live'));   // dispara o crescimento
    iniciarLoop();

    const flores = $('flowers');
    (function ciclo() {
      setTimeout(() => {
        flores.classList.add('out');                 // some devagar
        setTimeout(() => {
          flores.classList.remove('live', 'out');    // volta ao estado "semente"
          void flores.getBoundingClientRect();       // força reinício das animações
          flores.classList.add('live');              // nasce de novo
          ciclo();
        }, 2700);
      }, CFG.cicloMs);
    })();
  }

  iniciar();
})();
