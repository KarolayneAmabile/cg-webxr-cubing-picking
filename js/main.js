// Programa principal: cena Three.js, sessão WebXR (immersive-ar) com hit test,
// os dois módulos do enunciado e a interface.
//
//   Módulo A (cubagem): o operador aponta para um palete vazio, posiciona o
//   palete virtual sobre ele e, a cada toque, o sistema aloca a próxima caixa
//   na melhor posição, mostrando antes onde ela vai ficar.
//   Módulo B (caçamba): a caçamba é fixada numa posição detectada pelo hit
//   test; o operador mira onde quer colocar a caixa e o sistema destaca quando
//   não é possível empilhar ali.
//
// Sem suporte a AR (por exemplo, num computador), a mesma aplicação roda num
// modo de simulação: o mouse faz o papel da câmera e um clique no chão virtual
// faz o papel do hit test.

import * as THREE from '../lib/three.module.js';
import { ARButton } from '../lib/ARButton.js';
import { OrbitControls } from '../lib/OrbitControls.js';
import { randomBox, describeBox, COLORS, X_LIMIT, Y_LIMIT } from './boxes.js';
import { Container, MIN_SUPPORT } from './container.js';
import {
    PALLET, TRUCK, createPallet, createTruck, createBoxMesh, createGhost,
    setGhostState, setBoxHighlight, createReticle
} from './models.js';

const $ = (id) => document.getElementById(id);

// ------------------------------------------------------------------
// Estado da aplicação
// ------------------------------------------------------------------
// Cada módulo tem a sua área de carga (o mapa de alturas em container.js) e,
// depois de posicionada, o seu grupo 3D na cena.
const MODES = {
    cubing: {
        areaName: 'pallet', build: createPallet, area: null,
        container: new Container({ width: PALLET.width, depth: PALLET.depth, maxHeight: PALLET.maxLoad })
    },
    picking: {
        areaName: 'truck bed', build: createTruck, area: null,
        container: new Container({ width: TRUCK.width, depth: TRUCK.depth, maxHeight: TRUCK.wall })
    }
};

let mode = 'cubing';
let nextBox = randomBox();     // caixa que será colocada no próximo toque
let rotated = false;           // módulo B: caixa girada 90° pelo operador
let ghost = null;              // prévia da próxima caixa
let evaluation = null;         // onde e se a próxima caixa pode ser colocada
let suggestionDirty = true;    // módulo A: recalcular a posição sugerida
let highlighted = [];          // caixas destacadas por impedirem o empilhamento
let scale = 1;                 // 1 = tamanho real (chão); 0.25 = maquete (mesa)

let renderer, scene, camera, controls, simGround, reticle, controller;
const simBackground = new THREE.Color(0x30343a);

// hit test (mesmo esquema do exemplo webxr_ar_hittest.html)
let hitTestSource = null;
let hitTestSourceRequested = false;
let lastHit = null;            // resultado do hit test no quadro atual
let pendingPlacement = false;  // toque pedindo para posicionar a área
let inAR = false;

const clock = new THREE.Clock();
let elapsed = 0;
const dropping = [];           // animações de caixas caindo no lugar

// modo de simulação: mira do mouse
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
let pointerInside = false;
let pointerDown = null;
const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

init();

// ------------------------------------------------------------------
// Inicialização
// ------------------------------------------------------------------
function init() {
    // Cena, câmera, luz e renderer: mesma configuração do exemplo
    // webxr_ar_hittest.html (renderer com alpha e xr.enabled, luz hemisférica),
    // com uma luz direcional a mais para as faces das caixas ficarem distintas.
    scene = new THREE.Scene();
    scene.background = simBackground;

    camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.01, 40);
    camera.position.set(2.4, 1.9, 3.2);

    const light = new THREE.HemisphereLight(0xffffff, 0xbbbbff, 0.9);
    light.position.set(0.5, 1, 0.25);
    scene.add(light);
    const sun = new THREE.DirectionalLight(0xffffff, 0.6);
    sun.position.set(1, 3, 2);
    scene.add(sun);

    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.xr.enabled = true;
    document.body.appendChild(renderer.domElement);

    // Sessão WebXR: o hit test é obrigatório; o DOM overlay (painel na tela
    // durante o AR) e as âncoras (para a área ficar estável) são opcionais.
    document.body.appendChild(ARButton.createButton(renderer, {
        requiredFeatures: ['hit-test'],
        optionalFeatures: ['dom-overlay', 'anchors'],
        domOverlay: { root: $('overlay') }
    }));
    renderer.xr.addEventListener('sessionstart', onSessionStart);
    renderer.xr.addEventListener('sessionend', onSessionEnd);

    // Toque na tela durante o AR: o "controller" 0 dispara o evento select,
    // como no exemplo do professor.
    controller = renderer.xr.getController(0);
    controller.addEventListener('select', onSelect);
    scene.add(controller);

    reticle = createReticle();
    scene.add(reticle);

    // Chão quadriculado e controle de órbita, só no modo de simulação.
    simGround = new THREE.GridHelper(20, 40, 0x6a7078, 0x454a52);
    scene.add(simGround);
    controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 0.4, 0);
    controls.update();

    setupInput();
    setupUI();
    rebuildGhost();
    updateUI();

    window.addEventListener('resize', onWindowResize);
    renderer.setAnimationLoop(render);
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

// Entrou no AR: some o cenário simulado e aparece a câmera do aparelho.
function onSessionStart() {
    inAR = true;
    document.body.classList.add('ar');
    scene.background = null;
    simGround.visible = false;
    controls.enabled = false;
    resetAreas();
    updateUI();
}

// Saiu do AR: volta para a simulação.
function onSessionEnd() {
    inAR = false;
    document.body.classList.remove('ar');
    hitTestSource = null;
    hitTestSourceRequested = false;
    lastHit = null;
    pendingPlacement = false;
    scene.background = simBackground;
    simGround.visible = true;
    controls.enabled = true;
    $('overlay').style.display = '';   // o ARButton esconde o overlay ao sair
    camera.position.set(2.4, 1.9, 3.2);
    controls.target.set(0, 0.4, 0);
    controls.update();
    resetAreas();
    updateUI();
}

// ------------------------------------------------------------------
// Áreas de carga (palete e caçamba)
// ------------------------------------------------------------------
// Posiciona a área do módulo atual no ponto detectado pelo hit test, girada
// para a frente (lado +z, traseira aberta da caçamba) ficar virada para o
// operador. Quando o aparelho suporta âncoras, cria uma XRAnchor nesse ponto
// para a área continuar presa ao mundo real mesmo quando o rastreamento se
// corrige.
function placeArea(position, hit) {
    const m = MODES[mode];
    const { model, loadY } = m.build();
    const group = new THREE.Group();
    group.add(model);
    const load = new THREE.Group();          // origem = centro do piso da carga
    load.position.y = loadY;
    group.add(load);

    const camPos = new THREE.Vector3().setFromMatrixPosition(camera.matrixWorld);
    group.position.copy(position);
    group.rotation.y = Math.atan2(camPos.x - position.x, camPos.z - position.z);
    group.scale.setScalar(scale);
    scene.add(group);

    m.container.reset();
    m.area = { group, load, anchor: null, meshes: new Map() };

    if (hit && typeof hit.createAnchor === 'function') {
        hit.createAnchor().then((anchor) => {
            if (m.area && m.area.group === group) m.area.anchor = anchor;
            else anchor.delete();
        }).catch(() => { /* sem âncora: a área fica na posição do hit test */ });
    }
    suggestionDirty = true;
    updateUI();
}

function removeArea(m) {
    if (!m.area) return;
    if (ghost && ghost.parent === m.area.load) m.area.load.remove(ghost);
    if (m.area.anchor) m.area.anchor.delete();
    scene.remove(m.area.group);
    m.area = null;
    m.container.reset();
}

function resetAreas() {
    for (const m of Object.values(MODES)) removeArea(m);
    dropping.length = 0;
    highlighted = [];
    suggestionDirty = true;
}

function clearBoxes() {
    const m = MODES[mode];
    if (!m.area) return;
    for (const mesh of m.area.meshes.values()) m.area.load.remove(mesh);
    m.area.meshes.clear();
    m.container.reset();
    highlighted = [];
    suggestionDirty = true;
    updateUI();
}

// ------------------------------------------------------------------
// Próxima caixa e prévia
// ------------------------------------------------------------------
function newBox() {
    nextBox = randomBox();
    rotated = false;
    suggestionDirty = true;
    rebuildGhost();
    updateUI();
}

function rebuildGhost() {
    if (ghost) {
        if (ghost.parent) ghost.parent.remove(ghost);
        ghost.geometry.dispose();
    }
    ghost = createGhost(nextBox);
    ghost.visible = false;
}

// Coloca a próxima caixa na posição avaliada, com uma pequena animação de queda.
function commitBox(m, ev) {
    const record = m.container.place(nextBox, ev);
    const mesh = createBoxMesh(nextBox);
    mesh.position.set(record.x, record.y + 0.5, record.z);
    mesh.rotation.y = record.rotated ? Math.PI / 2 : 0;
    m.area.load.add(mesh);
    m.area.meshes.set(nextBox.id, mesh);
    dropping.push({ mesh, from: record.y + 0.5, to: record.y, k: 0 });
    newBox();
}

// Raio de mira: no AR, do centro da tela para a frente; na simulação, do mouse.
function aimRay() {
    if (inAR) {
        const origin = new THREE.Vector3().setFromMatrixPosition(camera.matrixWorld);
        const dir = new THREE.Vector3(0, 0, -1).transformDirection(camera.matrixWorld);
        return new THREE.Ray(origin, dir);
    }
    if (!pointerInside) return null;
    raycaster.setFromCamera(pointer, camera);
    return raycaster.ray.clone();
}

// Ponto da carga para onde o operador está mirando. O raio é levado para as
// coordenadas locais da área e percorrido em pequenos passos até encontrar o
// topo de uma pilha ou o piso. Assim dá para mirar em cima de uma pilha, e não
// só no chão. Se o raio passar fora da área, devolve o ponto no plano do piso
// (a avaliação vai dizer "fora da caçamba").
function aimPoint(m) {
    const ray = aimRay();
    if (!ray) return null;
    m.area.load.updateMatrixWorld();
    ray.applyMatrix4(new THREE.Matrix4().copy(m.area.load.matrixWorld).invert());
    const c = m.container, p = new THREE.Vector3();
    for (let t = 0; t < 40; t += c.cell / 2) {
        ray.at(t, p);
        const h = c.heightAt(p.x, p.z);
        if (h !== null && p.y <= h) return { x: p.x, z: p.z };
        if (p.y < 0) {
            if (ray.direction.y >= 0) return null;
            ray.at(-ray.origin.y / ray.direction.y, p);
            return { x: p.x, z: p.z };
        }
    }
    return null;
}

// Atualiza, a cada quadro, a avaliação da próxima caixa, a prévia e os
// destaques.
function updateGhost() {
    for (const mesh of highlighted) setBoxHighlight(mesh, false);
    highlighted = [];

    const m = MODES[mode];
    if (!m.area) { ghost.visible = false; evaluation = null; return; }
    if (ghost.parent !== m.area.load) m.area.load.add(ghost);

    if (mode === 'cubing') {
        // Módulo A: o sistema escolhe a posição (e a rotação) da caixa.
        if (suggestionDirty) {
            evaluation = m.container.findBest(nextBox);
            suggestionDirty = false;
        }
    } else {
        // Módulo B: o operador escolhe a posição mirando; o sistema só valida.
        const p = aimPoint(m);
        evaluation = p ? m.container.evaluateAt(nextBox, rotated, p.x, p.z) : null;
    }

    if (!evaluation) { ghost.visible = false; return; }
    const c = m.container.center(evaluation, nextBox);
    ghost.position.set(c.x, c.y, c.z);
    ghost.rotation.y = evaluation.rotated ? Math.PI / 2 : 0;
    ghost.visible = true;
    setGhostState(ghost, evaluation.ok, elapsed);

    // Destaque de "não é possível empilhar": além da prévia, piscam as caixas
    // de baixo que impedem o empilhamento pela regra de cores.
    if (!evaluation.ok) {
        for (const rec of evaluation.conflicts) {
            const mesh = m.area.meshes.get(rec.box.id);
            if (mesh) { setBoxHighlight(mesh, true, elapsed); highlighted.push(mesh); }
        }
    }
}

// ------------------------------------------------------------------
// Toque / clique
// ------------------------------------------------------------------
function onSelect() {
    const m = MODES[mode];

    // Primeiro toque: posiciona a área na superfície detectada.
    if (!m.area) {
        if (!inAR) updateSimReticle();   // um toque na tela pode chegar antes do próximo quadro
        if (!reticle.visible) { toast('No surface detected yet.'); return; }
        if (inAR) pendingPlacement = true;   // feito no próximo quadro, com o hit test dele
        else placeArea(new THREE.Vector3().setFromMatrixPosition(reticle.matrix), null);
        return;
    }

    // Demais toques: coloca a caixa, se a posição for válida.
    if (evaluation && evaluation.ok) {
        commitBox(m, evaluation);
    } else {
        toast(mode === 'cubing' ? 'No valid spot for this box. Try "New box".'
                                : 'Cannot place here: ' + reasonText(evaluation));
        if (navigator.vibrate) navigator.vibrate(150);
    }
}

function setupInput() {
    // Simulação: clique curto (sem arrastar) equivale ao toque do AR; arrastar
    // gira a câmera (OrbitControls).
    const canvas = renderer.domElement;
    const setPointer = (e) => {
        pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
        pointer.y = -(e.clientY / window.innerHeight) * 2 + 1;
        pointerInside = true;
    };
    canvas.addEventListener('pointermove', setPointer);
    canvas.addEventListener('pointerleave', () => { pointerInside = false; });
    canvas.addEventListener('pointerdown', (e) => { setPointer(e); pointerDown = { x: e.clientX, y: e.clientY }; });
    canvas.addEventListener('pointerup', (e) => {
        if (!inAR && pointerDown && Math.hypot(e.clientX - pointerDown.x, e.clientY - pointerDown.y) < 6) onSelect();
        pointerDown = null;
    });
    window.addEventListener('keydown', (e) => {
        if (e.key === 'r' || e.key === 'R') rotateBox();
        if (e.key === 'n' || e.key === 'N') newBox();
    });

    // Toques nos painéis não devem virar "select" no AR.
    for (const el of document.querySelectorAll('.panel, .toolbar'))
        el.addEventListener('beforexrselect', (e) => e.preventDefault());
}

// ------------------------------------------------------------------
// Laço de renderização
// ------------------------------------------------------------------
function render(timestamp, frame) {
    const dt = clock.getDelta();
    elapsed += dt;

    if (frame) {
        // Hit test: código do exemplo webxr_ar_hittest.html. Pede uma fonte de
        // hit test a partir do espaço 'viewer' (o centro da tela) e, a cada
        // quadro, posiciona a retícula na superfície real encontrada.
        const referenceSpace = renderer.xr.getReferenceSpace();
        const session = renderer.xr.getSession();

        if (hitTestSourceRequested === false) {
            session.requestReferenceSpace('viewer').then((viewerSpace) => {
                session.requestHitTestSource({ space: viewerSpace }).then((source) => {
                    hitTestSource = source;
                });
            });
            hitTestSourceRequested = true;
        }

        lastHit = null;
        if (hitTestSource) {
            const results = frame.getHitTestResults(hitTestSource);
            if (results.length) {
                lastHit = results[0];
                reticle.visible = true;
                reticle.matrix.fromArray(lastHit.getPose(referenceSpace).transform.matrix);
                reticle.matrix.scale(new THREE.Vector3(scale, scale, scale));
            } else {
                reticle.visible = false;
            }
        }

        // Toque pendente: posiciona a área com o hit test deste quadro.
        if (pendingPlacement) {
            pendingPlacement = false;
            if (lastHit) {
                const p = lastHit.getPose(referenceSpace).transform.position;
                placeArea(new THREE.Vector3(p.x, p.y, p.z), lastHit);
            }
        }

        // Áreas presas a âncoras acompanham a posição atualizada da âncora.
        for (const m of Object.values(MODES)) {
            const a = m.area;
            if (a && a.anchor && frame.trackedAnchors && frame.trackedAnchors.has(a.anchor)) {
                const pose = frame.getPose(a.anchor.anchorSpace, referenceSpace);
                if (pose) {
                    const p = pose.transform.position;
                    a.group.position.set(p.x, p.y, p.z);
                }
            }
        }
    } else {
        updateSimReticle();
    }

    // A retícula só aparece enquanto a área do módulo atual não foi posicionada.
    if (MODES[mode].area) reticle.visible = false;

    // Só a área do módulo atual fica visível.
    for (const [key, m] of Object.entries(MODES)) if (m.area) m.area.group.visible = key === mode;

    updateGhost();
    animateDrops(dt);
    updateStatus();

    renderer.render(scene, camera);
}

// Simulação: a "superfície detectada" é o ponto do chão sob o mouse.
function updateSimReticle() {
    const p = new THREE.Vector3();
    if (pointerInside) {
        raycaster.setFromCamera(pointer, camera);
        reticle.visible = raycaster.ray.intersectPlane(groundPlane, p) !== null;
        reticle.matrix.makeTranslation(p.x, p.y, p.z).scale(new THREE.Vector3(scale, scale, scale));
    } else {
        reticle.visible = false;
    }
}

function animateDrops(dt) {
    for (let i = dropping.length - 1; i >= 0; i--) {
        const d = dropping[i];
        d.k = Math.min(1, d.k + dt / 0.3);
        d.mesh.position.y = d.from + (d.to - d.from) * d.k * d.k;
        if (d.k >= 1) dropping.splice(i, 1);
    }
}

// ------------------------------------------------------------------
// Interface
// ------------------------------------------------------------------
function setupUI() {
    $('modeCubing').addEventListener('click', () => setMode('cubing'));
    $('modePicking').addEventListener('click', () => setMode('picking'));
    $('btnRotate').addEventListener('click', rotateBox);
    $('btnNewBox').addEventListener('click', newBox);
    $('btnClear').addEventListener('click', clearBoxes);
    $('btnMove').addEventListener('click', () => { removeArea(MODES[mode]); suggestionDirty = true; updateUI(); });
    $('btnScale').addEventListener('click', toggleScale);
    $('btnExit').addEventListener('click', () => { const s = renderer.xr.getSession(); if (s) s.end(); });
    $('panelTitle').addEventListener('click', () => document.body.classList.toggle('collapsed'));

    const L = (v) => Math.round(v * 1000);
    $('legend').innerHTML =
        `<span class="sw" style="background:${COLORS.red.css}"></span>Red: V &gt; ${L(X_LIMIT)} L &nbsp; ` +
        `<span class="sw" style="background:${COLORS.green.css}"></span>Green: ${L(Y_LIMIT)} L &lt; V &le; ${L(X_LIMIT)} L &nbsp; ` +
        `<span class="sw" style="background:${COLORS.blue.css}"></span>Blue: V &le; ${L(Y_LIMIT)} L<br>` +
        'Stacking: same color on same color · blue on green or red · green on red';

    if ('xr' in navigator) {
        navigator.xr.isSessionSupported('immersive-ar').then((ok) => {
            $('banner').textContent = ok
                ? 'AR is available: press START AR.'
                : 'AR is not available on this device. Simulation mode: the mouse stands in for the camera and clicking the floor stands in for hit testing.';
        });
    } else {
        $('banner').textContent = 'WebXR is not available (it needs HTTPS or localhost). Simulation mode: the mouse stands in for the camera.';
    }
}

function setMode(newMode) {
    mode = newMode;
    rotated = false;
    suggestionDirty = true;
    if (ghost.parent) ghost.parent.remove(ghost);
    updateUI();
}

function rotateBox() {
    if (mode !== 'picking') return;
    rotated = !rotated;
    updateUI();
}

// Alterna entre tamanho real (palete no chão) e maquete 1:4 (sobre uma mesa).
// Só a escala visual muda; as contas continuam em metros reais.
function toggleScale() {
    scale = scale === 1 ? 0.25 : 1;
    for (const m of Object.values(MODES)) if (m.area) m.area.group.scale.setScalar(scale);
    updateUI();
}

function updateUI() {
    const m = MODES[mode];
    $('modeCubing').classList.toggle('active', mode === 'cubing');
    $('modePicking').classList.toggle('active', mode === 'picking');

    const info = describeBox(nextBox);
    $('nextSwatch').style.background = COLORS[nextBox.color].css;
    $('nextText').textContent = `${info.dims} · ${info.liters} · ${COLORS[nextBox.color].name}` +
        (mode === 'picking' && rotated ? ' · rotated 90°' : '');

    const s = m.container.stats();
    $('stats').textContent = m.area
        ? `Occupancy ${Math.round(s.ratio * 100)}% · ${s.used.toFixed(2)} of ${s.capacity.toFixed(2)} m³ · ` +
          `${s.total} boxes (${s.count.red} red, ${s.count.green} green, ${s.count.blue} blue)`
        : `Load space: ${s.capacity.toFixed(2)} m³ (${m.container.width} × ${m.container.depth} m, up to ${m.container.maxHeight} m high)`;

    $('btnRotate').hidden = mode !== 'picking';
    $('btnClear').disabled = !m.area;
    $('btnMove').disabled = !m.area;
    $('btnScale').textContent = scale === 1 ? 'Scale: full size' : 'Scale: tabletop 1:4';
    $('btnExit').hidden = !inAR;
}

// Mensagem de orientação, recalculada a cada quadro (só mexe no DOM se mudar).
function updateStatus() {
    const m = MODES[mode];
    let text, warn = false;
    if (!m.area) {
        if (inAR) text = reticle.visible ? `Tap to place the ${m.areaName} on the detected surface.`
                                         : 'Move the phone slowly to detect the floor or a table…';
        else text = reticle.visible ? `Click (or tap) on the floor to place the ${m.areaName}.`
                                    : `Point at the floor (mouse or touch) to place the ${m.areaName}.`;
    } else if (mode === 'cubing') {
        if (evaluation) text = 'The preview shows where this box goes. Tap to stack it.';
        else { text = 'No valid spot for this box on the pallet. Use "New box".'; warn = true; }
    } else if (!evaluation) {
        text = inAR ? 'Aim the center of the screen at the truck bed.' : 'Point at the truck bed (mouse or touch).';
    } else if (evaluation.ok) {
        text = 'This spot is OK. Tap to place the box.';
    } else {
        text = 'Cannot place here: ' + reasonText(evaluation);
        warn = true;
    }
    const el = $('status');
    if (el.textContent !== text) el.textContent = text;
    el.classList.toggle('warn', warn);
    $('crosshair').hidden = !(inAR && mode === 'picking' && m.area);
}

function reasonText(ev) {
    if (!ev) return 'aim at the truck bed.';
    const cm = (v) => Math.round(v * 100);
    switch (ev.reason) {
        case 'outside': return 'outside the truck bed.';
        case 'height': return `the stack would go above the ${cm(MODES[mode].container.maxHeight)} cm limit.`;
        case 'color': return `a ${COLORS[nextBox.color].name.toLowerCase()} box cannot go on top of a ` +
                             `${COLORS[ev.conflicts[0].box.color].name.toLowerCase()} box.`;
        case 'support': return `not enough support underneath (at least ${MIN_SUPPORT * 100}% of the base).`;
        default: return '';
    }
}

let toastTimer = null;
function toast(text) {
    const el = $('toast');
    el.textContent = text;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, 1800);
}
