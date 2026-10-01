# Gerar emojis da biblioteca Lucide Icons

O ambiente onde este projeto foi editado não tem acesso à internet no
terminal, então os PNGs dos ícones não puderam ser baixados/gerados por lá.
O script `generate-lucide-emojis.js` faz isso na sua máquina (que tem
internet normalmente).

## Passo a passo

1. Na raiz do projeto, rode:
   ```
   npm install lucide-static sharp --no-save
   ```
2. Depois rode:
   ```
   node scripts/generate-lucide-emojis.js
   ```
3. Pronto — os PNGs (128x128, fundo transparente, ícones brancos) vão
   parar direto na pasta `Emojis/` na raiz do projeto, com os nomes exatos
   que `src/emojis.js` espera.
4. É só iniciar o bot normalmente: a sincronização automática
   (`syncApplicationEmojis`, em `src/emojis.js`) já sobe todos pro Discord
   sozinha na inicialização.

## Trocar algum ícone

Abra `generate-lucide-emojis.js` e edite o objeto `ICON_MAP` — a chave é o
nome do emoji usado no código do bot, o valor é o nome do ícone em
lucide.dev/icons. Depois rode o script de novo.

## Cor dos ícones

Por padrão os ícones saem brancos (constante `STROKE_COLOR` no topo do
script). Se quiser outra cor, é só trocar esse valor por outro hex.
