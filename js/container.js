// Área de carga (palete ou caçamba) representada como um mapa de alturas.
//
// O piso da área é dividido numa grade de células de 5 cm. Cada célula guarda a
// altura do topo do que está empilhado nela e qual caixa está no topo. Com isso
// dá para saber, para qualquer posição, em que altura uma caixa nova pousaria,
// quais caixas ficariam embaixo dela e se o empilhamento é permitido.
//
// Coordenadas locais em metros: origem no centro do piso da área, x para a
// largura, z para a profundidade e y para cima. Este módulo não usa Three.js.

import { canStackOn } from './boxes.js';

const EPS = 1e-6;

// Fração mínima da base da caixa que precisa estar apoiada na camada de baixo
// para ela não ficar "pendurada".
export const MIN_SUPPORT = 0.7;

export class Container {
    constructor({ width, depth, maxHeight, cell = 0.05 }) {
        this.width = width;
        this.depth = depth;
        this.maxHeight = maxHeight;
        this.cell = cell;
        this.nx = Math.round(width / cell);
        this.nz = Math.round(depth / cell);
        this.reset();
    }

    reset() {
        this.heights = new Float32Array(this.nx * this.nz);   // altura do topo em cada célula
        this.owner = new Int32Array(this.nx * this.nz).fill(-1); // caixa no topo de cada célula
        this.placed = [];                                       // caixas já colocadas
        this.byId = new Map();
    }

    // Quantas células a caixa ocupa em x e em z. "rotated" gira a caixa 90° em
    // torno do eixo vertical (troca largura e profundidade).
    footprint(box, rotated) {
        const w = rotated ? box.depth : box.width;
        const d = rotated ? box.width : box.depth;
        return {
            fx: Math.ceil(w / this.cell - EPS),
            fz: Math.ceil(d / this.cell - EPS),
            w, d
        };
    }

    // Converte um ponto local (x, z) na célula do canto da caixa, com a caixa
    // centralizada nesse ponto.
    cellAt(box, rotated, x, z) {
        const { fx, fz } = this.footprint(box, rotated);
        return {
            cx: Math.round((x + this.width / 2) / this.cell - fx / 2),
            cz: Math.round((z + this.depth / 2) / this.cell - fz / 2)
        };
    }

    // Verifica se a caixa pode ser colocada com o canto na célula (cx, cz).
    // Devolve { ok, reason, base, conflicts, ... }:
    //   reason: 'outside' | 'height' | 'color' | 'support' | null
    //   base: altura em que a caixa pousaria
    //   conflicts: caixas de baixo que impedem o empilhamento pela cor
    evaluate(box, cx, cz, rotated) {
        const { fx, fz, w, d } = this.footprint(box, rotated);
        const result = { ok: false, reason: null, base: 0, conflicts: [], supporters: [],
                         cx, cz, rotated, fx, fz, w, d };

        if (cx < 0 || cz < 0 || cx + fx > this.nx || cz + fz > this.nz) {
            result.reason = 'outside';
            return result;
        }

        // altura de pouso: o ponto mais alto embaixo da base da caixa
        let base = 0;
        for (let i = cx; i < cx + fx; i++)
            for (let k = cz; k < cz + fz; k++)
                base = Math.max(base, this.heights[k * this.nx + i]);
        result.base = base;

        // quais células sustentam a caixa e quais caixas estão nelas
        let supported = 0;
        const supporters = new Set();
        for (let i = cx; i < cx + fx; i++)
            for (let k = cz; k < cz + fz; k++) {
                const c = k * this.nx + i;
                if (Math.abs(this.heights[c] - base) < EPS) {
                    supported++;
                    if (this.owner[c] >= 0) supporters.add(this.owner[c]);
                }
            }
        result.supporters = [...supporters].map((id) => this.byId.get(id));

        if (base + box.height > this.maxHeight + EPS) {
            result.reason = 'height';
            return result;
        }

        // regra de cores: a caixa não pode ficar sobre uma de rank menor
        result.conflicts = result.supporters.filter((p) => !canStackOn(box.color, p.box.color));
        if (result.conflicts.length) {
            result.reason = 'color';
            return result;
        }

        if (base > EPS && supported / (fx * fz) < MIN_SUPPORT) {
            result.reason = 'support';
            return result;
        }

        result.ok = true;
        return result;
    }

    // Altura da pilha no ponto local (x, z), ou null fora da área. Usado para
    // descobrir em que ponto da carga a câmera está mirando.
    heightAt(x, z) {
        const i = Math.floor((x + this.width / 2) / this.cell);
        const k = Math.floor((z + this.depth / 2) / this.cell);
        if (i < 0 || k < 0 || i >= this.nx || k >= this.nz) return null;
        return this.heights[k * this.nx + i];
    }

    // Avalia a caixa centralizada no ponto local (x, z). Usado no módulo B,
    // em que o operador escolhe a posição apontando a câmera.
    evaluateAt(box, rotated, x, z) {
        const { cx, cz } = this.cellAt(box, rotated, x, z);
        return this.evaluate(box, cx, cz, rotated);
    }

    // Procura automaticamente a melhor posição válida (módulo A). A heurística
    // é a clássica "mais baixo, mais ao fundo, mais à esquerda": preenche o
    // piso primeiro e só sobe quando precisa. Testa as duas orientações.
    findBest(box) {
        let best = null;
        const orientations = box.width === box.depth ? [false] : [false, true];
        for (const rotated of orientations) {
            const { fx, fz } = this.footprint(box, rotated);
            for (let cz = 0; cz + fz <= this.nz; cz++)
                for (let cx = 0; cx + fx <= this.nx; cx++) {
                    const r = this.evaluate(box, cx, cz, rotated);
                    if (!r.ok) continue;
                    if (!best || r.base < best.base - EPS ||
                        (Math.abs(r.base - best.base) < EPS &&
                         (cz < best.cz || (cz === best.cz && cx < best.cx))))
                        best = r;
                }
        }
        return best;
    }

    // Registra a caixa na posição avaliada e atualiza o mapa de alturas.
    place(box, ev) {
        const top = ev.base + box.height;
        for (let i = ev.cx; i < ev.cx + ev.fx; i++)
            for (let k = ev.cz; k < ev.cz + ev.fz; k++) {
                const c = k * this.nx + i;
                this.heights[c] = top;
                this.owner[c] = box.id;
            }
        const record = { box, ...this.center(ev, box), rotated: ev.rotated };
        this.placed.push(record);
        this.byId.set(box.id, record);
        return record;
    }

    // Centro da caixa em coordenadas locais, a partir do resultado de evaluate().
    center(ev, box) {
        return {
            x: (ev.cx + ev.fx / 2) * this.cell - this.width / 2,
            y: ev.base + box.height / 2,
            z: (ev.cz + ev.fz / 2) * this.cell - this.depth / 2
        };
    }

    // Números da cubagem: volume ocupado em relação ao volume útil da área.
    stats() {
        const capacity = this.width * this.depth * this.maxHeight;
        const used = this.placed.reduce((s, p) => s + p.box.volume, 0);
        const count = { red: 0, green: 0, blue: 0 };
        for (const p of this.placed) count[p.box.color]++;
        return { capacity, used, ratio: used / capacity, count, total: this.placed.length };
    }
}
