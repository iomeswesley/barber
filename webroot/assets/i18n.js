/* ---------------- Internacionalização (pt-BR / fr / en) ----------------
   Abordagem "gettext": o TEXTO EM PORTUGUÊS é a chave. O HTML e os templates
   JS continuam em pt-BR (idioma-fonte, nada muda pra quem usa português) e
   este script traduz o DOM já renderizado usando o dicionário do idioma
   escolhido (assets/i18n/<lang>.js). Texto sem tradução simplesmente fica em
   português — nunca quebra a página.

   Precisa ser carregado no <head> SEM defer/async, logo depois de
   theme-init.js: em idioma != pt-BR ele esconde o <body> até a primeira
   tradução, senão o usuário veria um flash de português.

   Idioma: localStorage.lang (escolha manual, vence sempre) → navigator.languages
   → pt-BR. Nunca por IP (país ≠ idioma; Luxemburgo é multilíngue).

   Chaves com variável usam {0}, {1}... e viram regex — ex.:
   "Faltam {0} dias pro fim do seu teste" cobre o texto já interpolado. */
(function () {
  var LANGS = ["pt-BR", "fr", "en"];
  var LABELS = { "pt-BR": "Português", fr: "Français", en: "English" };
  var VERSION = "1";

  function detect() {
    try {
      var saved = localStorage.getItem("lang");
      if (LANGS.indexOf(saved) > -1) return saved;
    } catch (e) {}
    var list = navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language || ""];
    for (var i = 0; i < list.length; i++) {
      var l = String(list[i] || "").toLowerCase();
      if (l.indexOf("pt") === 0) return "pt-BR";
      if (l.indexOf("fr") === 0) return "fr";
      if (l.indexOf("en") === 0) return "en";
    }
    return "pt-BR";
  }

  var lang = detect();

  // Região do deploy (moeda, país, fuso): /assets/region.js é gerado pelo
  // servidor a partir de APP_* (ver src/app.ts). Carregado aqui, síncrono, pra
  // não exigir uma tag extra em cada página; lido só sob demanda (getters no
  // final), porque esse script roda logo depois deste.
  if (!window.APP_REGION) document.write('<script src="/assets/region.js"><\/script>');
  function region() {
    return window.APP_REGION || { locale: "pt-BR", country: "BR", currency: "BRL", timezone: "America/Sao_Paulo" };
  }
  var symbolCache = null;
  function currencySymbol() {
    var cur = region().currency;
    if (symbolCache && symbolCache.cur === cur) return symbolCache.sym;
    var sym = cur;
    try {
      var parts = new Intl.NumberFormat("en", { style: "currency", currency: cur, currencyDisplay: "narrowSymbol" }).formatToParts(0);
      for (var i = 0; i < parts.length; i++) if (parts[i].type === "currency") sym = parts[i].value;
    } catch (e) {}
    if (cur === "BRL") sym = "R$";
    symbolCache = { cur: cur, sym: sym };
    return sym;
  }
  // Textos com "R$" (rótulos, mockups) viram o símbolo da moeda do deploy —
  // só age fora do Brasil, onde o rótulo em português estaria errado.
  function fixCurrency(str) {
    var sym = currencySymbol();
    return sym === "R$" ? str : str.replace(/R\$/g, sym);
  }
  var root = document.documentElement;
  var script = document.currentScript;
  var scope = (script && script.getAttribute("data-scope")) || "public";

  // Locale do Intl pra data/número (formato regional, independe do idioma do texto).
  var INTL = { "pt-BR": "pt-BR", fr: "fr-LU", en: "en-GB" };

  var dict = {}; // chave normalizada -> tradução
  var patterns = null; // [{re, out, len}] compilado sob demanda
  var active = false; // vira true no boot, quando já se sabe idioma e região

  function norm(s) {
    return String(s).replace(/\s+/g, " ").trim();
  }
  function escapeRe(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function compilePatterns() {
    patterns = [];
    for (var key in dict) {
      if (!/\{\d+\}/.test(key)) continue;
      // Padrão com pouco texto fixo (ex: "{1} com {2}") casaria com qualquer
      // frase do usuário que contenha esse trecho e a reescreveria (achado no
      // teste do painel: mensagens de cliente viravam "... avec ..."). Só
      // vale padrão com pelo menos 4 caracteres fixos; o resto usa t() no JS.
      if (key.replace(/\{\d+\}/g, "").replace(/\s+/g, "").length < 4) continue;
      var re = "^" + escapeRe(key).replace(/\\\{(\d+)\\\}/g, "(.+?)") + "$";
      // Ordem em que cada {n} aparece na chave = índice do grupo capturado
      // (a numeração pode começar em {1} ou pular números).
      var order = [];
      key.replace(/\{(\d+)\}/g, function (_, n) {
        if (order.indexOf(n) < 0) order.push(n);
        return _;
      });
      patterns.push({ re: new RegExp(re), out: dict[key], len: key.length, order: order, keyNums: (key.match(/\{\d+\}/g) || []).map(function (x) { return x.slice(1, -1); }) });
    }
    patterns.sort(function (a, b) {
      return b.len - a.len;
    });
  }

  // Traduz uma string; devolve a original se não houver tradução.
  // Monta o dicionário e decide se o motor está ativo. Idempotente e chamado
  // sob demanda: scripts da página podem chamar t() antes do DOMContentLoaded,
  // e os dicionários (scripts síncronos do <head>) já estão carregados então.
  var built = false;
  function buildDict() {
    if (built) return;
    built = true;
    var d = window.I18N_DICT || {};
    dict = {};
    var sets = [d[lang], d[lang + "-errors"], d[lang + "-app"], d[lang + "-app2"]];
    for (var i = 0; i < sets.length; i++) {
      if (!sets[i]) continue;
      for (var k in sets[i]) dict[norm(k)] = sets[i][k];
    }
    patterns = null;
    // Ativo = traduz (idioma != pt-BR) OU corrige o símbolo da moeda (deploy
    // fora do Brasil, mesmo em português).
    active = pending || currencySymbol() !== "R$";
  }

  function tr(str) {
    if (typeof str !== "string") return str;
    buildDict();
    if (lang === "pt-BR") return /R\$/.test(str) ? fixCurrency(str) : str;
    var out = trDict(str);
    return /R\$/.test(out) ? fixCurrency(out) : out;
  }
  function trDict(str) {
    var m = /^(\s*)([\s\S]*?)(\s*)$/.exec(str);
    var core = norm(m[2]);
    if (!core) return str;
    var hit = Object.prototype.hasOwnProperty.call(dict, core) ? dict[core] : null;
    if (hit == null) {
      if (!patterns) compilePatterns();
      for (var i = 0; i < patterns.length; i++) {
        var mm = patterns[i].re.exec(core);
        if (mm) {
          var p = patterns[i];
          // Um grupo por ocorrência de {n} na chave, na ordem em que aparecem.
          hit = p.out.replace(/\{(\d+)\}/g, function (_, n) {
            var pos = p.keyNums.indexOf(n);
            var v = pos < 0 ? null : mm[pos + 1];
            return v == null ? "" : v;
          });
          break;
        }
      }
    }
    return hit == null ? str : m[1] + hit + m[3];
  }

  // t("texto {nome}", { nome: "x" }) — pra strings montadas em JS.
  function t(str, params) {
    var out = tr(str);
    if (params) {
      out = out.replace(/\{(\w+)\}/g, function (all, k) {
        return Object.prototype.hasOwnProperty.call(params, k) ? params[k] : all;
      });
    }
    return out;
  }

  var SKIP_TAGS = { SCRIPT: 1, STYLE: 1, TEXTAREA: 1, NOSCRIPT: 1, CODE: 1, PRE: 1, SVG: 1 };
  var ATTRS = ["placeholder", "title", "aria-label", "alt"];
  var observer = null;

  function skipped(el) {
    for (; el && el.nodeType === 1; el = el.parentNode) {
      if (SKIP_TAGS[el.tagName.toUpperCase()] || el.hasAttribute("data-no-i18n") || el.getAttribute("translate") === "no") return true;
    }
    return false;
  }

  function translateTextNode(node) {
    var v = node.nodeValue;
    if (!v || !/\S/.test(v)) return;
    var out = tr(v);
    if (out !== v) node.nodeValue = out;
  }

  // Atributos (placeholder etc.) valem também em <textarea>/<input>: só o
  // CONTEÚDO de textarea/script/style é intocável, não seus atributos.
  function attrSkipped(el) {
    for (; el && el.nodeType === 1; el = el.parentNode) {
      var tag = el.tagName.toUpperCase();
      if (tag === "SCRIPT" || tag === "STYLE" || tag === "NOSCRIPT" || el.hasAttribute("data-no-i18n") || el.getAttribute("translate") === "no") return true;
    }
    return false;
  }

  function translateElementAttrs(el) {
    if (attrSkipped(el)) return;
    for (var i = 0; i < ATTRS.length; i++) {
      var a = el.getAttribute(ATTRS[i]);
      if (a) {
        var out = tr(a);
        if (out !== a) el.setAttribute(ATTRS[i], out);
      }
    }
  }

  function translateSubtree(node) {
    buildDict();
    if (!active || !node) return;
    if (node.nodeType === 3) {
      if (!skipped(node.parentNode)) translateTextNode(node);
      return;
    }
    if (node.nodeType !== 1 || skipped(node)) return;

    // Parágrafos com marcação inline: a chave é o innerHTML inteiro.
    var htmlEls = node.hasAttribute("data-i18n-html") ? [node] : [];
    var found = node.querySelectorAll ? node.querySelectorAll("[data-i18n-html]") : [];
    for (var h = 0; h < found.length; h++) htmlEls.push(found[h]);
    var handled = [];
    for (var j = 0; j < htmlEls.length; j++) {
      var el = htmlEls[j];
      var out = tr(el.innerHTML);
      if (out !== el.innerHTML) el.innerHTML = out;
      handled.push(el);
    }

    var walker = document.createTreeWalker(node, 4, {
      acceptNode: function (n) {
        for (var p = n.parentNode; p && p !== node.parentNode; p = p.parentNode) {
          if (p.nodeType !== 1) continue;
          if (SKIP_TAGS[p.tagName.toUpperCase()] || p.hasAttribute("data-no-i18n") || p.getAttribute("translate") === "no") return 2;
          if (p.hasAttribute("data-i18n-html")) return 2;
        }
        return 1;
      },
    });
    var n;
    var texts = [];
    while ((n = walker.nextNode())) texts.push(n);
    for (var k = 0; k < texts.length; k++) translateTextNode(texts[k]);

    translateElementAttrs(node);
    var withAttrs = node.querySelectorAll ? node.querySelectorAll("[placeholder],[title],[aria-label],[alt]") : [];
    for (var m2 = 0; m2 < withAttrs.length; m2++) {
      translateElementAttrs(withAttrs[m2]);
    }
  }

  function startObserver() {
    if (observer || !window.MutationObserver) return;
    observer = new MutationObserver(function (records) {
      for (var i = 0; i < records.length; i++) {
        var r = records[i];
        if (r.type === "characterData") {
          if (!skipped(r.target.parentNode)) translateTextNode(r.target);
        } else if (r.type === "attributes") {
          translateElementAttrs(r.target);
        } else {
          for (var j = 0; j < r.addedNodes.length; j++) translateSubtree(r.addedNodes[j]);
        }
      }
      observer.takeRecords(); // descarta o eco das nossas próprias escritas
    });
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ATTRS,
    });
  }

  function mountSwitchers() {
    var holders = document.querySelectorAll("[data-lang-switch]");
    for (var i = 0; i < holders.length; i++) {
      var h = holders[i];
      if (h.getAttribute("data-mounted")) continue;
      h.setAttribute("data-mounted", "1");
      var sel = document.createElement("select");
      sel.className = "lang-switch-select";
      sel.setAttribute("aria-label", "Language");
      sel.setAttribute("data-no-i18n", "");
      sel.style.cssText = "color-scheme:light dark;background:var(--card-bg-solid,#fff);color:inherit;border:1px solid var(--border,rgba(128,128,128,.4));border-radius:8px;padding:6px 8px;font:inherit;font-size:13px;cursor:pointer;";
      for (var j = 0; j < LANGS.length; j++) {
        var o = document.createElement("option");
        o.value = LANGS[j];
        o.textContent = LABELS[LANGS[j]];
        o.style.cssText = "color-scheme:light dark;background:var(--card-bg-solid,#fff);";
        if (LANGS[j] === lang) o.selected = true;
        sel.appendChild(o);
      }
      sel.addEventListener("change", function (e) {
        setLang(e.target.value);
      });
      h.appendChild(sel);
    }
  }

  function setLang(next) {
    if (LANGS.indexOf(next) < 0) return;
    try {
      localStorage.setItem("lang", next);
    } catch (e) {}
    location.reload();
  }

  root.setAttribute("lang", lang);
  var pending = lang !== "pt-BR";
  if (pending) {
    root.classList.add("i18n-pending");
    var st = document.createElement("style");
    st.textContent = "html.i18n-pending body{visibility:hidden}";
    document.head.appendChild(st);
    // Dicionário síncrono (bloqueia o parser, de propósito): garante que existe
    // antes do DOMContentLoaded. Só carrega pra idioma != pt-BR.
    var base = "/assets/i18n/" + lang;
    // fr.js (páginas públicas) e fr-errors.js (mensagens de erro da API, que
    // aparecem em qualquer página) sempre; o painel carrega também fr-app*.js.
    var parts = ["", "-errors"];
    if (scope === "app") parts.push("-app", "-app2");
    for (var pi = 0; pi < parts.length; pi++) document.write('<script src="' + base + parts[pi] + ".js?v=" + VERSION + '"><\/script>');
  }

  function boot() {
    buildDict();
    if (active) {
      translateSubtree(document.body);
      if (document.title) document.title = tr(document.title);
      startObserver();
      root.classList.remove("i18n-pending");
    }
    mountSwitchers();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
  // Rede de segurança: nunca deixa a página escondida se algo falhar.
  setTimeout(function () {
    root.classList.remove("i18n-pending");
  }, 4000);

  if (pending) {
    var nativeAlert = window.alert;
    var nativeConfirm = window.confirm;
    window.alert = function (m) {
      return nativeAlert.call(window, tr(String(m)));
    };
    window.confirm = function (m) {
      return nativeConfirm.call(window, tr(String(m)));
    };
  }

  var api = {
    lang: lang,
    langs: LANGS,
    intlLocale: INTL[lang],
    tr: tr,
    t: t,
    setLang: setLang,
    apply: translateSubtree,
    // Formata dinheiro na moeda da região do deploy (nunca fixo em BRL).
    fmtCurrency: function (value, fractionDigits) {
      var o = { style: "currency", currency: region().currency };
      if (fractionDigits !== undefined) o.maximumFractionDigits = fractionDigits;
      return new Intl.NumberFormat(INTL[lang], o).format(value || 0);
    },
  };
  // Lidos sob demanda: region.js só termina de carregar depois deste script.
  Object.defineProperty(api, "currency", { get: function () { return region().currency; } });
  Object.defineProperty(api, "currencySymbol", { get: currencySymbol });
  Object.defineProperty(api, "country", { get: function () { return region().country; } });
  Object.defineProperty(api, "timezone", { get: function () { return region().timezone; } });
  window.I18N = api;
  window.t = t;
})();
