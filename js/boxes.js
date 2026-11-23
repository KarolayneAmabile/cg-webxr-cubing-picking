// Regras de negócio das caixas: geração aleatória, cor pelo volume e regra de
// empilhamento. Este módulo não usa Three.js, então pode ser testado no Node.

// Limites de volume do enunciado, em metros cúbicos:
//   vermelha: V > X      verde: Y < V <= X      azul: V <= Y
// O enunciado não diz o que fazer quando V é exatamente igual a X ou a Y;
// aqui o valor igual ao limite fica na cor de menor volume.
// Com dimensões entre 15 e 55 cm, esses limites dão cerca de 28% de caixas
// azuis, 40% verdes e 32% vermelhas.
export const Y_LIMIT = 0.025;   // 25 litros
export const X_LIMIT = 0.050;   // 50 litros

// Faixa das dimensões geradas (largura, altura e profundidade), em metros.
export const DIM_MIN = 0.15;
export const DIM_MAX = 0.55;

// "rank" define a ordem de empilhamento: uma caixa só pode ficar sobre outra
// de rank maior ou igual.
export const COLORS = {
    red:   { rank: 3, hex: 0xd63a3a, css: '#d63a3a', name: 'Red' },
    green: { rank: 2, hex: 0x2fa84f, css: '#2fa84f', name: 'Green' },
    blue:  { rank: 1, hex: 0x2f6fd6, css: '#2f6fd6', name: 'Blue' }
};

export function classify(volume) {
    if (volume > X_LIMIT) return 'red';
    if (volume > Y_LIMIT) return 'green';
    return 'blue';
}

// Regra de empilhamento do enunciado:
//   - caixas podem ser empilhadas em caixas da mesma cor;
//   - azul pode ficar sobre verde ou vermelha;
//   - verde pode ficar sobre vermelha.
// Ou seja, a caixa de cima precisa ter rank menor ou igual ao da de baixo.
export function canStackOn(topColor, bottomColor) {
    return COLORS[topColor].rank <= COLORS[bottomColor].rank;
}

let nextId = 1;

// Gera uma caixa com largura (x), altura (y) e profundidade (z) aleatórias,
// arredondadas ao centímetro. Nenhum modelo é fixo: cada caixa nasce aqui.
export function randomBox(random = Math.random) {
    const dim = () => Math.round((DIM_MIN + random() * (DIM_MAX - DIM_MIN)) * 100) / 100;
    const width = dim(), height = dim(), depth = dim();
    const volume = width * height * depth;
    return { id: nextId++, width, height, depth, volume, color: classify(volume) };
}

// Textos usados na interface.
export function describeBox(box) {
    const cm = (m) => Math.round(m * 100);
    return {
        dims: `${cm(box.width)} × ${cm(box.height)} × ${cm(box.depth)} cm`,
        liters: `${(box.volume * 1000).toFixed(1)} L`
    };
}
