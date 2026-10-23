# SEI → Cobalto

## Instalar
1. Descompacte a pasta.
2. Chrome → `chrome://extensions` → ative **Modo do desenvolvedor** → **Carregar sem compactação** → escolha a pasta.
3. Se o seu SEI não for `sei.ufpel.edu.br`, troque o endereço em `manifest.json` (duas seções: `host_permissions` e `content_scripts`) e recarregue a extensão.

## Uso rápido (botão no SEI)
1. Abra o plano de trabalho no Cobalto **uma vez** (a extensão guarda o ID do plano, as ações e os saldos).
2. No ícone da extensão, escolha a **Ação**, as **horas do dia** (padrão 8h) e o horário do envio automático (padrão 17:30).
3. No SEI, clique em **→ Cobalto** ao lado de um processo ou Despacho. O item entra na fila do dia (o ícone da extensão mostra quantos há).
4. No horário configurado, a extensão cria **um lançamento do dia** na Ação escolhida, com os itens separados por vírgula, ex.:
   `Elaboração de Despacho 4248552 no processo 23110.026892/1984-89, Despacho 4248600 no processo …; Análise dos processos 23110.029312/1900-10, ….`
   Se não couber em 256 caracteres, divide em mais de um lançamento no mesmo dia, repartindo as horas.
- Quer enviar antes? Use **Enviar agora** no aviso que aparece no SEI ou no popup. Dias antigos que ficaram na fila são enviados na próxima verificação (a cada 15 min, com o Chrome aberto).
- Não envia se o dia já tiver 8h lançadas ou se faltar saldo na ação; os itens ficam na fila e o ícone mostra "!".

## Observações
- A extensão **não grava nada** quando você só abre o plano no Cobalto: ela apenas lê o plano e as ações. Só o botão → Cobalto (e "Enviar agora" / envio automático) lançam.
- Despachos do mesmo processo ficam juntos e o número do processo aparece uma vez.
- Atividade manual (campo no popup) entra na fila de hoje e vai na mesma descrição do dia.
- Opções avançadas (ícone → Opções): limite de horas/dia, envio automático e tipos de documento (`Despacho`, `Ofício`…).
- Se o seu SEI não for `sei.ufpel.edu.br`, troque o endereço em `manifest.json`.

# Estenção disponibilizada e mantida pela PROGEP.
# Sugestões e melhorias? Manda para nós ...   
