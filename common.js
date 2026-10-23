// Configuração padrão e utilidades compartilhadas (service worker, popup, options, content scripts).
(function (g) {
  const DEFAULT_CONFIG = {
    horasDia: 8,                       // limite de horas lançadas por dia
    envio: {
      auto: true,                      // envia a fila do dia sozinho, em segundo plano, a partir do horário abaixo
      horario: '17:30'
    },
    sei: {
      tiposDocumento: ['Despacho']     // tipos de documento que recebem o botão → Cobalto (ex.: 'Despacho', 'Ofício', 'Memorando')
    }
  };

  function merge(a, b) {
    if (b === undefined) return a;
    if (a === null || typeof a !== 'object' || Array.isArray(a)) return b;
    const out = {};
    for (const k of Object.keys(a)) out[k] = k in (b || {}) ? merge(a[k], b[k]) : a[k]; // só chaves conhecidas
    return out;
  }

  g.VC = {
    DEFAULT_CONFIG,
    hoje: () => new Date().toLocaleDateString('sv-SE'),
    async getConfig() {
      const { config } = await chrome.storage.local.get('config');
      return merge(DEFAULT_CONFIG, config && typeof config === 'object' ? config : {});
    }
  };
})(globalThis);
