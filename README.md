# WebXR Augmented Reality for Load Cubing and Guided Picking

Aplicação de Realidade Aumentada na Web (WebXR + Three.js) que ajuda operadores de logística a visualizar o preenchimento de um palete (cubagem) e a carregar uma caçamba de caminhão sem quebrar as regras de empilhamento.

Demonstração: https://cubing.karolayne.com

## Objetivo

Em centros de distribuição, erros na escolha de produtos (picking) e o mau aproveitamento do volume dos paletes geram custos altos. A aplicação sobrepõe ao mundo real, pela câmera do celular, onde cada caixa deve ser colocada e quando um empilhamento não é permitido, sem consultar tabelas externas. A especificação completa está em [especificacao.txt](especificacao.txt).

## Como funciona

As caixas não são modelos fixos: cada uma é gerada com largura, altura e profundidade aleatórias (de 15 a 55 cm). O volume define a cor:

| Cor | Volume |
|---|---|
| Vermelha | V > X = 50 L |
| Verde | Y = 25 L < V ≤ X = 50 L |
| Azul | V ≤ Y = 25 L |

Regra de empilhamento: uma caixa pode ficar sobre outra da mesma cor; azul pode ficar sobre verde ou vermelha; verde pode ficar sobre vermelha. Na prática, a caixa de cima precisa ter cor de "nível" menor ou igual ao da de baixo (vermelha > verde > azul). Também é preciso que a caixa caiba na área, não passe da altura máxima e tenha pelo menos 70% da base apoiada.

Módulo A, cubagem no palete. O operador aponta a câmera para o chão onde está o palete vazio, e o hit test encontra a superfície real. Um toque posiciona o palete virtual (PBR, 1,2 × 1,0 m). A partir daí, o sistema calcula a melhor posição para a próxima caixa e mostra uma prévia de onde ela vai ficar. Cada toque empilha a caixa. O painel mostra a ocupação do volume útil (palete com carga de até 1 m de altura).

Módulo B, caçamba. A caçamba (1,4 × 2,2 m, paredes de 90 cm) é fixada numa posição detectada pelo hit test. O operador mira o centro da tela onde quer colocar a caixa. Quando não é possível empilhar ali, a prévia fica amarela e pisca, as caixas de baixo que impedem o empilhamento também piscam e o painel explica o motivo. O toque só coloca a caixa se a posição for válida.

Outros recursos: botão para girar a caixa 90° (módulo B), gerar outra caixa, esvaziar a área, reposicionar a área e alternar entre tamanho real (no chão) e maquete 1:4 (sobre uma mesa). Quando o aparelho suporta, a área fica presa a uma âncora WebXR (XRAnchor), o que a mantém estável no lugar.

## Como executar

### No celular (AR)

O WebXR exige um aparelho Android com Chrome e ARCore (Google Play Services for AR) e uma página servida por HTTPS. No iPhone, o Safari ainda não tem WebXR para AR; lá a página abre no modo de simulação.

1. Abra https://cubing.karolayne.com no Chrome do celular.
2. Toque em START AR e permita o uso da câmera.
3. Mova o celular devagar até aparecer o anel branco sobre o chão ou a mesa.
4. Toque para posicionar o palete (ou a caçamba, na aba B) e siga as instruções do painel.

### No computador (modo de simulação)

Sem suporte a AR, a mesma aplicação roda numa cena simulada: o mouse faz o papel da câmera e um clique no chão quadriculado faz o papel do hit test. Arrastar gira a vista; R gira a caixa e N gera outra.

```bash
cd cg-webxr-cubing-picking
python3 -m http.server 8000
# abrir http://localhost:8000
```

Para testar o AR com o celular ligado ao computador por USB, sem publicar: ative a depuração USB, rode `adb reverse tcp:8000 tcp:8000` e abra `http://localhost:8000` no Chrome do celular (`localhost` conta como conexão segura).

### Testes

As regras (cores, empilhamento e cubagem) têm testes que rodam no Node 22, sem navegador:

```bash
npm test
```

## Deploy

O site roda em https://cubing.karolayne.com, na mesma VPS do calico. A cada push na `main`, o workflow [.github/workflows/deploy.yml](.github/workflows/deploy.yml) faz o seguinte:

1. `check`: roda os testes.
2. `build`: gera a imagem Docker (um Caddy mínimo servindo os arquivos estáticos, ver [Dockerfile](Dockerfile)) e publica no GHCR como `ghcr.io/<dono>/<repo>`.
3. `deploy`: usa o mesmo caminho do calico, GitHub OIDC → papel da AWS → AWS SSM → [deploy/update.sh](deploy/update.sh) na VPS. O script baixa a imagem, reinicia o contêiner e confere se o site responde. Não há SSH nem credencial fixa guardada no GitHub.

Na VPS, o contêiner fica em `/home/ubuntu/cubing` ([deploy/compose.yml](deploy/compose.yml)) e não abre porta nenhuma. Ele entra só na rede `calico_web`, criada pela pilha do calico e compartilhada apenas com o Caddy, com o nome `cubing`. Ele nunca entra na `calico_default`, onde estão o app e o banco do calico. O Caddy do calico, que já cuida do HTTPS, repassa `cubing.karolayne.com` para `cubing:80`. Esse bloco está no `deploy/Caddyfile` do repositório do calico e libera a câmera e o WebXR para este site (`Permissions-Policy`).

### Antes do primeiro deploy

1. DNS: criar o registro `cubing.karolayne.com` apontando para a VPS, igual ao `calico.karolayne.com`.
2. Calico: fazer o deploy do calico com o Caddyfile novo. O `update.sh` dele reinicia o Caddy quando o Caddyfile muda. Até o contêiner do cubing existir, esse endereço responde 502, e o calico não é afetado.
3. AWS: o papel `cubing-github-deploy` (conta 078601608558) já existe. Ele tem as mesmas permissões do `calico-github-deploy`: só `AWS-RunShellScript` na instância `i-03d48a1982e6632f2`, mais a leitura do resultado do comando. A política de confiança aceita apenas a `main` de um repositório `cg-webxr-cubing-picking` em `KarolayneAmabile` ou `miauware`, travada pelo ID de cada conta. Depois de criar o repositório, dá para restringir ainda mais, trocando o `*` pelo ID do repositório.

Depois disso, um push na `main` publica o site. Também é possível disparar à mão em Actions → Build and deploy → Run workflow.

## Estrutura

```
index.html          interface (painel e botões, também usados durante o AR)
css/style.css       estilo da interface
js/main.js          cena Three.js, sessão WebXR, hit test, âncoras e os dois módulos
js/boxes.js         geração das caixas, cor pelo volume e regra de empilhamento
js/container.js     mapa de alturas da área: validação e busca da melhor posição
js/models.js        palete, caçamba, caixas e prévia, gerados por código
lib/                Three.js r134, ARButton e OrbitControls (do repositório da disciplina)
tests/              testes das regras (npm test)
Dockerfile          imagem de produção (Caddy servindo os arquivos estáticos)
docker/Caddyfile    configuração do Caddy dentro da imagem
deploy/             pilha da VPS (compose.yml) e script de atualização (update.sh)
.github/workflows/  build e deploy
```

## Créditos

Este projeto foi desenvolvido para a disciplina de Computação Gráfica do curso de Bacharelado em Ciência da Computação do Instituto Federal de Educação, Ciência e Tecnologia de Goiás - Campus Anápolis. Projeto idealizado pelo Prof. Me. [Alessandro Rodrigues e Silva](https://www.escavador.com/sobre/4512567/alessandro-rodrigues-e-silva) e desenvolvido por Karolayne Amábile Brito Borges.

O Three.js (r134), o `ARButton.js`, o `OrbitControls.js` e o exemplo de hit test em que a aplicação se baseia vêm do repositório da disciplina, que inclui o [Three.js](https://threejs.org) (licença MIT).
