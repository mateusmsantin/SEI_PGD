const $ = s => document.querySelector(s);
const st = (t, ok = true) => { $('#st').textContent = t; $('#st').style.color = ok ? '#1f7a3d' : '#b3261e'; };
VC.getConfig().then(c => { $('#cfg').value = JSON.stringify(c, null, 2); });
$('#salvar').onclick = async () => {
  try { const c = JSON.parse($('#cfg').value); await chrome.storage.local.set({ config: c }); st('Salvo.'); }
  catch (e) { st('JSON inválido: ' + e.message, false); }
};
$('#padrao').onclick = async () => {
  await chrome.storage.local.remove('config');
  $('#cfg').value = JSON.stringify(VC.DEFAULT_CONFIG, null, 2); st('Padrão restaurado.');
};
