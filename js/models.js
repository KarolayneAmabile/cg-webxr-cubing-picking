// Modelos 3D da cena, todos gerados por código com Three.js (nenhum arquivo de
// modelo é carregado): palete, caçamba de caminhão, caixas, a prévia
// ("fantasma") da próxima caixa e a retícula do hit test.

import * as THREE from '../lib/three.module.js';
import { COLORS } from './boxes.js';

// Medidas em metros, em tamanho real.
// Palete PBR padrão (1,2 × 1,0 m, 14,4 cm de altura). A carga pode subir até
// 1 m acima dele.
export const PALLET = { width: 1.2, depth: 1.0, height: 0.144, maxLoad: 1.0 };
// Caçamba: piso de 1,4 × 2,2 m a 45 cm do chão, com paredes de 90 cm.
// A traseira (lado +z) fica aberta e virada para o operador.
export const TRUCK = { width: 1.4, depth: 2.2, floorY: 0.45, wall: 0.9 };

const wood = new THREE.MeshStandardMaterial({ color: 0xb58a57, roughness: 0.9 });
const metal = new THREE.MeshStandardMaterial({ color: 0x8c949c, roughness: 0.5, metalness: 0.4 });
const dark = new THREE.MeshStandardMaterial({ color: 0x2b2e33, roughness: 0.8 });
const cab = new THREE.MeshStandardMaterial({ color: 0xe8b21f, roughness: 0.6 });
const wallMat = new THREE.MeshStandardMaterial({
    color: 0xa9b3bd, roughness: 0.4, metalness: 0.3,
    transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false
});

// caixa com o centro da base em (x, y, z)
function block(w, h, d, material, x, y, z) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
    m.position.set(x, y + h / 2, z);
    return m;
}

// Contorno do volume útil da área (até onde a carga pode subir). Ajuda a
// visualizar a cubagem.
function capacityOutline(width, height, depth, y0) {
    const lines = new THREE.LineSegments(
        new THREE.EdgesGeometry(new THREE.BoxGeometry(width, height, depth)),
        new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.45 })
    );
    lines.position.y = y0 + height / 2;
    return lines;
}

// Palete PBR: três tábuas de base, nove blocos, três travessas e sete tábuas
// no tampo. Devolve o modelo e a altura onde começa a carga.
export function createPallet() {
    const g = new THREE.Group();
    const { width: W, depth: D } = PALLET;
    const t = 0.022;                         // espessura das tábuas
    for (const z of [-0.45, 0, 0.45]) g.add(block(W, t, 0.1, wood, 0, 0, z));
    for (const x of [-0.55, 0, 0.55])
        for (const z of [-0.45, 0, 0.45]) g.add(block(0.1, 0.078, 0.1, wood, x, t, z));
    for (const x of [-0.55, 0, 0.55]) g.add(block(0.1, t, D, wood, x, 0.1, 0));
    for (let i = 0; i < 7; i++) g.add(block(W, t, 0.1, wood, 0, 0.122, -0.45 + i * 0.15));
    g.add(capacityOutline(W, PALLET.maxLoad, D, PALLET.height));
    return { model: g, loadY: PALLET.height, size: { width: W, depth: D, maxHeight: PALLET.maxLoad } };
}

// Caçamba de caminhão: chassi, rodas, cabine na frente (lado -z), piso e
// paredes semitransparentes (para ver a carga de fora) com a traseira aberta.
export function createTruck() {
    const g = new THREE.Group();
    const { width: W, depth: D, floorY: F, wall: H } = TRUCK;
    // chassi e rodas
    for (const x of [-0.45, 0.45]) g.add(block(0.12, 0.15, D + 1.2, dark, x, 0.25, -0.6));
    const wheelGeo = new THREE.CylinderGeometry(0.25, 0.25, 0.22, 24).rotateZ(Math.PI / 2);
    for (const x of [-0.62, 0.62])
        for (const z of [0.65, -0.65, -1.85]) {
            const wheel = new THREE.Mesh(wheelGeo, dark);
            wheel.position.set(x, 0.25, z);
            g.add(wheel);
        }
    // cabine
    g.add(block(W, 1.1, 0.9, cab, 0, 0.4, -D / 2 - 0.55));
    // piso e paredes (esquerda, direita e frente)
    g.add(block(W + 0.08, 0.05, D, metal, 0, F - 0.05, 0));
    g.add(block(0.04, H, D, wallMat, -W / 2 - 0.02, F, 0));
    g.add(block(0.04, H, D, wallMat, W / 2 + 0.02, F, 0));
    g.add(block(W + 0.08, H, 0.04, wallMat, 0, F, -D / 2 - 0.02));
    g.add(capacityOutline(W, H, D, F));
    return { model: g, loadY: F, size: { width: W, depth: D, maxHeight: H } };
}

// Caixa de carga: a cor vem do volume (boxes.js) e as arestas escuras ajudam a
// distinguir caixas encostadas.
export function createBoxMesh(box) {
    const geometry = new THREE.BoxGeometry(box.width, box.height, box.depth);
    const material = new THREE.MeshStandardMaterial({ color: COLORS[box.color].hex, roughness: 0.85 });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.add(new THREE.LineSegments(new THREE.EdgesGeometry(geometry),
        new THREE.LineBasicMaterial({ color: 0x111111 })));
    return mesh;
}

// Prévia da próxima caixa: mesma forma, semitransparente.
export function createGhost(box) {
    const geometry = new THREE.BoxGeometry(box.width, box.height, box.depth);
    const material = new THREE.MeshStandardMaterial({
        color: COLORS[box.color].hex, transparent: true, opacity: 0.5,
        depthWrite: false, emissive: 0x000000
    });
    const mesh = new THREE.Mesh(geometry, material);
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geometry),
        new THREE.LineBasicMaterial({ color: 0xffffff }));
    mesh.add(edges);
    mesh.userData = { box, edges };
    return mesh;
}

// Destaque de "não é possível empilhar": a prévia fica amarela e pisca.
// Amarelo foi escolhido porque não se confunde com as cores das caixas.
export const WARN_COLOR = 0xffd400;

export function setGhostState(ghost, valid, time) {
    const { box, edges } = ghost.userData;
    const pulse = 0.5 + 0.5 * Math.sin(time * 10);
    if (valid) {
        ghost.material.color.setHex(COLORS[box.color].hex);
        ghost.material.emissive.setHex(0x000000);
        ghost.material.opacity = 0.45 + 0.15 * pulse;
        edges.material.color.setHex(0xffffff);
    } else {
        ghost.material.color.setHex(WARN_COLOR);
        ghost.material.emissive.setHex(WARN_COLOR);
        ghost.material.emissiveIntensity = 0.3 + 0.5 * pulse;
        ghost.material.opacity = 0.35 + 0.35 * pulse;
        edges.material.color.setHex(WARN_COLOR);
    }
}

// Faz uma caixa já colocada piscar em amarelo (é ela que impede o empilhamento).
export function setBoxHighlight(mesh, on, time) {
    if (on) {
        mesh.material.emissive.setHex(WARN_COLOR);
        mesh.material.emissiveIntensity = 0.35 + 0.35 * Math.sin(time * 10);
    } else {
        mesh.material.emissive.setHex(0x000000);
    }
}

// Retícula do hit test: o anel do exemplo webxr_ar_hittest.html do Three.js
// (repositório do professor), que mostra onde a superfície real foi detectada.
export function createReticle() {
    const reticle = new THREE.Mesh(
        new THREE.RingGeometry(0.15, 0.2, 32).rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial()
    );
    reticle.matrixAutoUpdate = false;
    reticle.visible = false;
    return reticle;
}
