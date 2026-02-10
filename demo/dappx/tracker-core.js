/************* Shared helpers *************/
function collectAddressesFromResults(results) {
  var set = new Set();
  var out = [];
  if (!results || !results.length) return out;

  results.forEach(function (r) {
    if (!r || !Array.isArray(r.accounts)) return;
    r.accounts.forEach(function (addr) {
      if (!addr) return;
      if (!set.has(addr)) {
        set.add(addr);
        out.push(addr);
      }
    });
  });
  return out;
}

/************* Provider discovery *************/
function discoverProviders() {
  return new Promise(function (resolve) {
    var announced = [];

    function onAnnounce(e) {
      ("onAnnounce", e.detail.info.name);
      if (!e || !e.detail) return;
      var d = e.detail;
      if (d && d.provider) announced.push(d);
    }

    window.addEventListener("eip6963:announceProvider", onAnnounce);
    window.dispatchEvent(new Event("eip6963:requestProvider"));

    setTimeout(function () {
      window.removeEventListener("eip6963:announceProvider", onAnnounce);

      if (announced.length > 0) {
        var seen = new Set();
        var list = announced
          .filter(function (d) {
            if (seen.has(d.info.name)) return false;
            seen.add(d.info.name);
            return true;
          })
          .map(function (d) {
            var info = d.info || {};
            return {
              provider: d.provider,
              name: info.name || info.rdns || "wallet",
            };
          });
        resolve(list);
        return;
      }

      if (window.ethereum) {
        var providers;
        if (
          Array.isArray(window.ethereum.providers) &&
          window.ethereum.providers.length
        ) {
          providers = window.ethereum.providers;
        } else {
          providers = [window.ethereum];
        }

        resolve(
          providers.map(function (p, i) {
            return {
              provider: p,
              name: p.isMetaMask
                ? "MetaMask"
                : p.isCoinbaseWallet
                  ? "Coinbase"
                  : "wallet:" + i,
            };
          }),
        );
      } else {
        resolve([]);
      }
    }, 2000);
  });
}
function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("timeout")), ms),
    ),
  ]);
}
/************* Probing *************/
async function probeWallets(contextLabel) {
  var providers = await discoverProviders();
  var results = [];

  if (!providers.length) {
    results.push({
      wallet: "(none)",
      accounts: [],
      error: "No wallet providers detected",
    });

    return {
      context: contextLabel,
      origin: window.location.origin,
      results: results,
    };
  }

  for (var i = 0; i < providers.length; i++) {
    var w = providers[i];
    try {
      var accs = await withTimeout(
        w.provider.request({ method: "eth_accounts", params: [] }),
        1500,
      );
      results.push({
        wallet: w.name,
        accounts: accs || [],
        error: null,
      });
    } catch (e) {
      if (e.message != "timeout") {
        results.push({
          wallet: w.name,
          accounts: [],
          error: e && e.message ? e.message : String(e),
        });
      }
    }
  }
  return {
    context: contextLabel,
    origin: window.location.origin,
    results: results,
  };
}

async function probeAndPost(contextLabel, targetWindow, messageType) {
  var data = await probeWallets(contextLabel);

  if (targetWindow && messageType) {
    try {
      targetWindow.postMessage(
        {
          type: messageType,
          payload: data,
        },
        "*",
      );
    } catch (e) {
      console.warn("tracker-core: postMessage failed", e);
    }
  }

  return data;
}

/************* Local log rendering (optional) *************/
function renderTrackerLocalIfPresent(data) {
  var logEl = document.getElementById("localLog");
  if (!logEl) return;

  logEl.innerHTML = "";

  // Header: context + origin
  var header = document.createElement("div");
  header.className = "entry";
  header.innerHTML =
    '<span class="tag">' +
    data.context +
    "</span> " +
    "<code>" +
    data.origin +
    "</code>";
  logEl.appendChild(header);

  var results = data.results || [];
  results.forEach(function (r) {
    var div = document.createElement("div");
    div.className = "entry";

    var title = document.createElement("div");
    title.innerHTML =
      '<span class="wallet-name">' +
      r.wallet +
      "</span> – " +
      (r.error
        ? "error"
        : Array.isArray(r.accounts) && r.accounts.length
          ? r.accounts.length + " address(es)"
          : "no address visible");

    var accounts = document.createElement("div");
    accounts.className = "accounts";
    accounts.textContent = r.error ? r.error : JSON.stringify(r.accounts || []);

    div.appendChild(title);
    div.appendChild(accounts);
    logEl.appendChild(div);
  });
}

/************* Auto-tracker (realistic behavior) *************/
function startAutoTracker(options) {
  options = options || {};
  var targetWindow = options.targetWindow || window.parent;
  var messageType = options.messageType || "walletExposureFromIframe";
  var intervalMs = options.intervalMs || 5000;
  var contextPrefix = options.contextPrefix || "tracker";

  async function singleProbe(label) {
    var data = await probeAndPost(label, targetWindow, messageType);
    // Local visualization if the host page has a log container
    renderTrackerLocalIfPresent(data);
  }

  singleProbe(contextPrefix + "-on-load");
  setInterval(function () {
    singleProbe(contextPrefix + "-auto");
  }, intervalMs);
}

/************* Export + auto-start *************/
window.walletTracker = {
  discoverProviders: discoverProviders,
  probeWallets: probeWallets,
  probeAndPost: probeAndPost,
  startAutoTracker: startAutoTracker,
};

// 🧠 IMPORTANT: Automatically behave like a tracker as soon as this script loads.
(function () {
  try {
    startAutoTracker({
      // behaves like third-party tracker: report to parent frame if any
      targetWindow: window.parent !== window ? window.parent : null,
      messageType: "walletExposureFromIframe",
      intervalMs: 5000,
      contextPrefix: "dapp-tracker",
    });
  } catch (e) {
    console.warn("tracker-core: auto-start failed", e);
  }
})();
