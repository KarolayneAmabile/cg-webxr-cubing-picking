// Testes das regras do enunciado e da área de carga (rodam no Node, sem navegador):
//   npm test
// O workflow de deploy roda estes testes antes de gerar a imagem.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classify, canStackOn, randomBox, X_LIMIT, Y_LIMIT, COLORS } from '../js/boxes.js';
import { Container } from '../js/container.js';

// gerador previsível, para os testes darem sempre o mesmo resultado
function seeded(seed) {
    let s = seed;
    return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

test('a cor vem do volume (vermelha > X, Y < verde <= X, azul <= Y)', () => {
    assert.equal(classify(X_LIMIT + 1e-4), 'red');
    assert.equal(classify(X_LIMIT), 'green');
    assert.equal(classify((X_LIMIT + Y_LIMIT) / 2), 'green');
    assert.equal(classify(Y_LIMIT + 1e-4), 'green');
    assert.equal(classify(Y_LIMIT), 'blue');
    assert.equal(classify(0.001), 'blue');
});

test('regra de empilhamento do enunciado', () => {
    // para cada cor de cima, as cores de baixo permitidas
    const allowed = { red: ['red'], green: ['red', 'green'], blue: ['red', 'green', 'blue'] };
    for (const top of Object.keys(COLORS))
        for (const bottom of Object.keys(COLORS))
            assert.equal(canStackOn(top, bottom), allowed[top].includes(bottom), `${top} sobre ${bottom}`);
});

test('caixas aleatórias têm dimensões, volume e cor coerentes', () => {
    const rand = seeded(3);
    for (let i = 0; i < 500; i++) {
        const b = randomBox(rand);
        for (const d of [b.width, b.height, b.depth]) assert.ok(d >= 0.15 && d <= 0.55);
        assert.ok(Math.abs(b.volume - b.width * b.height * b.depth) < 1e-12);
        assert.equal(b.color, classify(b.volume));
    }
});

test('cubagem automática nunca sobrepõe caixas nem quebra as regras', () => {
    const rand = seeded(1);
    for (let trial = 0; trial < 60; trial++) {
        const c = new Container({ width: 1.2, depth: 1.0, maxHeight: 1.0 });
        for (let n = 0; n < 50; n++) {
            const box = randomBox(rand);
            const ev = c.findBest(box);
            if (ev) { assert.ok(ev.ok); c.place(box, ev); }
        }
        const boxes = c.placed.map((p) => {
            const w = p.rotated ? p.box.depth : p.box.width;
            const d = p.rotated ? p.box.width : p.box.depth;
            return {
                color: p.box.color,
                min: [p.x - w / 2, p.y - p.box.height / 2, p.z - d / 2],
                max: [p.x + w / 2, p.y + p.box.height / 2, p.z + d / 2]
            };
        });
        const eps = 1e-6;
        for (const b of boxes) {
            assert.ok(b.min[0] >= -0.6 - eps && b.max[0] <= 0.6 + eps, 'dentro em x');
            assert.ok(b.min[2] >= -0.5 - eps && b.max[2] <= 0.5 + eps, 'dentro em z');
            assert.ok(b.max[1] <= 1.0 + eps, 'abaixo da altura máxima');
        }
        for (let i = 0; i < boxes.length; i++)
            for (let j = i + 1; j < boxes.length; j++) {
                const a = boxes[i], b = boxes[j];
                const overlap = (k) => a.min[k] < b.max[k] - eps && b.min[k] < a.max[k] - eps;
                assert.ok(!(overlap(0) && overlap(1) && overlap(2)), 'caixas sobrepostas');
                if (overlap(0) && overlap(2)) {
                    if (Math.abs(b.min[1] - a.max[1]) < eps) assert.ok(canStackOn(b.color, a.color));
                    if (Math.abs(a.min[1] - b.max[1]) < eps) assert.ok(canStackOn(a.color, b.color));
                }
            }
    }
});

test('caçamba: detecta cor proibida, fora da área, altura e falta de apoio', () => {
    const c = new Container({ width: 1.4, depth: 2.2, maxHeight: 0.9 });
    const box = (id, w, h, d, color) => ({ id, width: w, height: h, depth: d, volume: w * h * d, color });
    const blue = box(1, 0.3, 0.2, 0.3, 'blue');
    c.place(blue, c.evaluateAt(blue, false, 0, 0));

    const red = box(2, 0.3, 0.5, 0.3, 'red');
    const onBlue = c.evaluateAt(red, false, 0, 0);
    assert.equal(onBlue.reason, 'color');
    assert.deepEqual(onBlue.conflicts.map((p) => p.box.id), [1]);

    assert.equal(c.evaluateAt(red, false, 5, 0).reason, 'outside');
    assert.equal(c.evaluateAt(box(3, 0.3, 0.8, 0.3, 'red'), false, 0, 0).reason, 'height');

    const small = box(4, 0.2, 0.1, 0.2, 'blue');
    assert.equal(c.evaluateAt(small, false, 0.2, 0).reason, 'support');
    assert.ok(c.evaluateAt(small, false, 0, 0).ok, 'azul sobre azul');
});
