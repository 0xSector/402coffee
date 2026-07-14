// @purpose The human path: a zero-dependency, embeddable tip button + modal that runs the
//   full x402 flow in the browser. The payer picks a tier, connects an injected wallet
//   (MetaMask/Coinbase/Rabby), signs an EIP-3009 TransferWithAuthorization with
//   eth_signTypedData_v4 (no gas — it's a signature, not a transaction), and we POST it as
//   the PAYMENT-SIGNATURE header. The signing shape is validated against the live
//   facilitator (scripts/validate-signing.mjs, isValid:true). Shadow DOM isolates all CSS
//   from the host page. Embed:
//     <script src="https://402coffee.com/widget.js" data-handle="tim" async></script>
(function () {
  "use strict";
  var script = document.currentScript;
  if (!script) { console.error("[402coffee] widget must be loaded via <script src>"); return; }
  var ds = script.dataset;
  var HANDLE = ds.handle;
  if (!HANDLE) { console.error("[402coffee] add data-handle to the script tag"); return; }
  var ACCENT = ds.accent || "#f5a623";
  var INLINE = ds.inline != null;
  var LABEL = ds.label || "Buy me a coffee";
  var BASE = (ds.base || new URL(script.src).origin).replace(/\/$/, "");

  // Idempotent: never inject twice for the same handle.
  if (document.querySelector('[data-402coffee="' + HANDLE + '"]')) return;

  // Advertise a machine-discoverable tip link for agents crawling the page (slice 4 convention).
  if (!document.querySelector('link[rel="tip"]')) {
    var lk = document.createElement("link");
    lk.rel = "tip"; lk.href = BASE + "/t/" + HANDLE;
    document.head.appendChild(lk);
  }

  // ---- helpers -------------------------------------------------------------
  function el(tag, attrs, kids) {
    var e = document.createElement(tag);
    if (attrs) for (var k in attrs) { if (k === "style") e.style.cssText = attrs[k]; else if (k === "html") e.innerHTML = attrs[k]; else e.setAttribute(k, attrs[k]); }
    (kids || []).forEach(function (c) { e.appendChild(typeof c === "string" ? document.createTextNode(c) : c); });
    return e;
  }
  function provider() { return window.ethereum || null; }
  function randNonce() {
    var b = new Uint8Array(32); crypto.getRandomValues(b);
    return "0x" + Array.from(b).map(function (x) { return x.toString(16).padStart(2, "0"); }).join("");
  }
  function b64(obj) { return btoa(unescape(encodeURIComponent(JSON.stringify(obj)))); }
  function chainHexFromCaip2(net) { return "0x" + parseInt(String(net).split(":")[1], 10).toString(16); }

  // ---- styles (scoped in shadow root) --------------------------------------
  var CSS = "\n" +
    ":host{all:initial}\n" +
    "*{box-sizing:border-box;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif}\n" +
    ".btn{display:inline-flex;align-items:center;gap:8px;border:0;border-radius:999px;padding:11px 18px;font-size:15px;font-weight:600;color:#1a1205;background:" + ACCENT + ";cursor:pointer;box-shadow:0 2px 10px rgba(0,0,0,.18);transition:transform .08s ease}\n" +
    ".btn:hover{transform:translateY(-1px)}\n" +
    ".float{position:fixed;right:20px;bottom:20px;z-index:2147483000}\n" +
    ".ov{position:fixed;inset:0;background:rgba(10,12,16,.55);backdrop-filter:blur(3px);display:flex;align-items:center;justify-content:center;z-index:2147483001;padding:16px}\n" +
    ".card{width:100%;max-width:380px;background:#fff;color:#1a1a1a;border-radius:18px;padding:22px;box-shadow:0 20px 60px rgba(0,0,0,.4);animation:pop .16s ease}\n" +
    "@keyframes pop{from{transform:scale(.96);opacity:.4}to{transform:scale(1);opacity:1}}\n" +
    ".hd{display:flex;align-items:center;justify-content:space-between;margin-bottom:6px}\n" +
    ".ttl{font-size:18px;font-weight:700}\n" +
    ".x{border:0;background:none;font-size:22px;line-height:1;cursor:pointer;color:#888}\n" +
    ".sub{color:#666;font-size:13px;margin-bottom:16px}\n" +
    ".tiers{display:flex;gap:8px;margin-bottom:12px}\n" +
    ".tier{flex:1;border:1.5px solid #e4e4e7;border-radius:12px;padding:12px 8px;text-align:center;cursor:pointer;background:#fafafa}\n" +
    ".tier.sel{border-color:" + ACCENT + ";background:" + ACCENT + "22}\n" +
    ".tier .em{font-size:22px}\n" +
    ".tier .lb{font-size:12px;color:#555;margin-top:2px}\n" +
    ".tier .pr{font-size:13px;font-weight:700;margin-top:2px}\n" +
    ".row{margin-bottom:10px}\n" +
    "input,textarea{width:100%;border:1.5px solid #e4e4e7;border-radius:10px;padding:10px 12px;font-size:14px;resize:none}\n" +
    "input:focus,textarea:focus{outline:none;border-color:" + ACCENT + "}\n" +
    ".pay{width:100%;border:0;border-radius:12px;padding:13px;font-size:15px;font-weight:700;color:#1a1205;background:" + ACCENT + ";cursor:pointer;margin-top:6px}\n" +
    ".pay:disabled{opacity:.55;cursor:default}\n" +
    ".msg{font-size:13px;margin-top:10px;min-height:18px}\n" +
    ".err{color:#c0392b}\n" +
    ".ok{color:#1e7d34}\n" +
    ".ft{margin-top:14px;text-align:center;font-size:11px;color:#aaa}\n" +
    ".ft a{color:#aaa;text-decoration:none}\n" +
    ".spin{display:inline-block;width:14px;height:14px;border:2px solid #1a120544;border-top-color:#1a1205;border-radius:50%;animation:sp .7s linear infinite;vertical-align:-2px}\n" +
    "@keyframes sp{to{transform:rotate(360deg)}}\n";

  // ---- widget state --------------------------------------------------------
  var creator = null, tiers = [], selected = 0, customUsd = null, root, host;

  function mount() {
    host = el("div", { "data-402coffee": HANDLE });
    root = host.attachShadow({ mode: "open" });
    root.appendChild(el("style", { html: CSS }));
    var btn = el("button", { class: "btn" + (INLINE ? "" : " float") }, ["☕", LABEL]);
    btn.onclick = open;
    root.appendChild(btn);
    (INLINE ? script.parentNode.insertBefore(host, script) : document.body.appendChild(host));
  }

  function fetchCreator() {
    return fetch(BASE + "/api/creators/" + HANDLE).then(function (r) {
      if (!r.ok) throw new Error("creator not found"); return r.json();
    });
  }

  function open() {
    (creator ? Promise.resolve(creator) : fetchCreator().then(function (c) { creator = c; tiers = c.tiers || []; return c; }))
      .then(renderModal)
      .catch(function (e) { alert("[402coffee] " + e.message); });
  }

  function money(u) { return "$" + (Number(u) % 1 === 0 ? Number(u).toFixed(0) : Number(u).toFixed(2)); }

  function renderModal() {
    var emojiFor = function (k) { return k === "tokens" ? "🧠" : k === "coffee" ? "☕" : k === "beer" ? "🍺" : "💛"; };
    var tierEls = tiers.map(function (t, i) {
      var d = el("div", { class: "tier" + (i === selected && customUsd == null ? " sel" : "") }, [
        el("div", { class: "em" }, [emojiFor(t.key)]),
        el("div", { class: "lb" }, [t.label || t.key]),
        el("div", { class: "pr" }, [money(t.usd)]),
      ]);
      d.onclick = function () { selected = i; customUsd = null; draw(); };
      return d;
    });
    var custom = el("input", { type: "number", min: String(creator.min_usd || 0.25), step: "0.25", placeholder: "Custom amount (USD)" });
    custom.oninput = function () { customUsd = custom.value ? Number(custom.value) : null; highlightTiers(); };
    var name = el("input", { type: "text", maxlength: "60", placeholder: "Your name (optional)" });
    var message = el("textarea", { rows: "2", maxlength: "280", placeholder: "Say something nice (optional)" });
    var msg = el("div", { class: "msg" });
    var payBtn = el("button", { class: "pay" }, ["Tip " + amountLabel()]);

    var card = el("div", { class: "card" }, [
      el("div", { class: "hd" }, [
        el("div", { class: "ttl" }, ["☕ Tip @" + HANDLE]),
        (function () { var x = el("button", { class: "x" }, ["×"]); x.onclick = close; return x; })(),
      ]),
      el("div", { class: "sub" }, [creator.display_name ? creator.display_name + (creator.bio ? " · " + creator.bio : "") : (creator.bio || "Non-custodial USDC tip, straight to their wallet.")]),
      el("div", { class: "tiers" }, tierEls),
      el("div", { class: "row" }, [custom]),
      el("div", { class: "row" }, [name]),
      el("div", { class: "row" }, [message]),
      payBtn, msg,
      el("div", { class: "ft" }, [el("a", { href: BASE + "/" + HANDLE, target: "_blank" }, ["Powered by 402 Coffee · no gas · no custody"])]),
    ]);
    var ov = el("div", { class: "ov" }, [card]);
    ov.onclick = function (e) { if (e.target === ov) close(); };

    function amountLabel() { return money(currentUsd()); }
    function highlightTiers() {
      root.querySelectorAll(".tier").forEach(function (n, i) { n.classList.toggle("sel", customUsd == null && i === selected); });
      payBtn.textContent = "Tip " + amountLabel();
    }
    function draw() { highlightTiers(); }

    payBtn.onclick = function () { pay(payBtn, msg, { name: name.value, message: message.value }); };

    // swap in
    if (root.__ov) root.removeChild(root.__ov);
    root.appendChild(ov); root.__ov = ov;
  }

  function currentUsd() {
    if (customUsd != null && customUsd > 0) return customUsd;
    return tiers[selected] ? tiers[selected].usd : (creator.min_usd || 1);
  }
  function close() { if (root && root.__ov) { root.removeChild(root.__ov); root.__ov = null; } }

  // ---- the x402 payment flow ----------------------------------------------
  function pay(btn, msg, extra) {
    var eth = provider();
    msg.className = "msg";
    if (!eth) { msg.className = "msg err"; msg.textContent = "No Ethereum wallet found. Install MetaMask or Coinbase Wallet."; return; }
    var usd = currentUsd();
    if (!(usd > 0)) { msg.className = "msg err"; msg.textContent = "Enter an amount."; return; }
    var url = BASE + "/t/" + HANDLE + "?amount=" + encodeURIComponent(usd);
    var busy = function (t) { btn.disabled = true; btn.innerHTML = '<span class="spin"></span> ' + t; };
    var fail = function (t) { btn.disabled = false; btn.textContent = "Tip $" + usd; msg.className = "msg err"; msg.textContent = t; };

    busy("Getting challenge");
    fetch(url).then(function (r) {
      if (r.status !== 402) throw new Error("Unexpected " + r.status + " from tip endpoint");
      return r.json();
    }).then(function (chal) {
      var req = chal.accepts && chal.accepts[0];
      if (!req) throw new Error("No payment requirements in challenge");
      busy("Connecting wallet");
      return eth.request({ method: "eth_requestAccounts" }).then(function (accts) {
        var from = accts && accts[0];
        if (!from) throw new Error("No account");
        var wantChain = chainHexFromCaip2(req.network);
        return ensureChain(eth, wantChain).then(function () { return sign(eth, from, req); });
      }).then(function (paymentHeader) {
        busy("Settling");
        return fetch(url, {
          method: "POST",
          headers: { "content-type": "application/json", "PAYMENT-SIGNATURE": paymentHeader },
          body: JSON.stringify({ channel: "widget", name: extra.name || null, message: extra.message || null, url: location.href }),
        });
      }).then(function (r) { return r.json().then(function (b) { return { status: r.status, body: b }; }); })
        .then(function (res) {
          if (res.status !== 200 || !res.body.ok) throw new Error(res.body.error || "Payment failed");
          success(btn, msg, res.body.receipt, usd);
        });
    }).catch(function (e) {
      var m = e && e.message ? e.message : String(e);
      if (/User rejected|denied|4001/i.test(m)) m = "Signature cancelled.";
      fail(m);
    });
  }

  function ensureChain(eth, wantHex) {
    return eth.request({ method: "eth_chainId" }).then(function (cur) {
      if (String(cur).toLowerCase() === wantHex.toLowerCase()) return;
      return eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId: wantHex }] });
    });
  }

  function sign(eth, from, req) {
    var chainId = parseInt(String(req.network).split(":")[1], 10);
    var extra = req.extra || {};
    var nowSec = Math.floor(Date.now() / 1000);
    var authorization = {
      from: from,
      to: req.payTo,
      value: String(req.amount),
      validAfter: "0",
      validBefore: String(nowSec + (req.maxTimeoutSeconds || 600) + 600),
      nonce: randNonce(),
    };
    var typed = {
      types: {
        EIP712Domain: [
          { name: "name", type: "string" }, { name: "version", type: "string" },
          { name: "chainId", type: "uint256" }, { name: "verifyingContract", type: "address" },
        ],
        TransferWithAuthorization: [
          { name: "from", type: "address" }, { name: "to", type: "address" },
          { name: "value", type: "uint256" }, { name: "validAfter", type: "uint256" },
          { name: "validBefore", type: "uint256" }, { name: "nonce", type: "bytes32" },
        ],
      },
      domain: { name: extra.name, version: extra.version, chainId: chainId, verifyingContract: req.asset },
      primaryType: "TransferWithAuthorization",
      message: authorization,
    };
    return eth.request({ method: "eth_signTypedData_v4", params: [from, JSON.stringify(typed)] })
      .then(function (signature) {
        return b64({ x402Version: 2, accepted: req, payload: { signature: signature, authorization: authorization } });
      });
  }

  function success(btn, msg, receipt, usd) {
    btn.disabled = true; btn.textContent = "✓ Thank you!";
    msg.className = "msg ok";
    var tx = receipt && receipt.tx_hash;
    msg.innerHTML = "Sent " + money(usd) + " · " +
      (tx ? '<a href="https://basescan.org/tx/' + tx + '" target="_blank" style="color:#1e7d34">view tx</a> · ' : "") +
      '<a href="' + BASE + "/" + HANDLE + '#wall" target="_blank" style="color:#1e7d34">you\'re on the wall</a>';
    confetti();
    setTimeout(close, 4000);
  }

  function confetti() {
    var colors = [ACCENT, "#4fc3f7", "#66bb6a", "#ef5350", "#ab47bc"];
    for (var i = 0; i < 40; i++) {
      (function (i) {
        var p = el("div", { style: "position:fixed;left:" + (50 + (Math.random() * 40 - 20)) + "vw;top:40vh;width:8px;height:8px;background:" + colors[i % colors.length] + ";z-index:2147483002;border-radius:2px;pointer-events:none" });
        document.body.appendChild(p);
        var dx = (Math.random() * 2 - 1) * 240, dy = (Math.random() * -1 - 0.5) * 300;
        p.animate([{ transform: "translate(0,0) rotate(0)", opacity: 1 }, { transform: "translate(" + dx + "px," + (-dy + 500) + "px) rotate(" + (Math.random() * 720) + "deg)", opacity: 0 }], { duration: 1400 + Math.random() * 700, easing: "cubic-bezier(.2,.6,.4,1)" });
        setTimeout(function () { p.remove(); }, 2200);
      })(i);
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount); else mount();
})();
