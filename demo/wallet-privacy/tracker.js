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

function renderAddresses(logEl, addresses) {
  if (!logEl) return;

  logEl.innerHTML = "";
  var entry = document.createElement("div");
  entry.className = "entry";

  if (!addresses.length) {
    var msg = document.createElement("div");
    msg.className = "placeholder-text";
    msg.textContent = "No wallet addresses visible.";
    entry.appendChild(msg);
  } else {
    addresses.forEach(function (addr) {
      var line = document.createElement("div");
      line.className = "address-line";
      line.textContent = addr;
      entry.appendChild(line);
    });
  }

  logEl.appendChild(entry);
}

/************* Top-level probing *************/
function discoverProviders() {
  return new Promise(function (resolve) {
    var announced = [];

    function onAnnounce(e) {
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
            if (seen.has(d.provider)) return false;
            seen.add(d.provider);
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
    }, 500);
  });
}

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
      var accs = await w.provider.request({
        method: "eth_accounts",
        params: [],
      });
      results.push({
        wallet: w.name,
        accounts: accs || [],
        error: null,
      });
    } catch (e) {
      results.push({
        wallet: w.name,
        accounts: [],
        error: e && e.message ? e.message : String(e),
      });
    }
  }

  return {
    context: contextLabel,
    origin: window.location.origin,
    results: results,
  };
}

// DOM refs
var logTopEl = document.getElementById("logTop");
var walletProvidersLineEl = document.getElementById("walletProvidersLine");
var walletLeakLineEl = document.getElementById("walletLeakLine");
var noWalletNoticeEl = document.getElementById("noWalletNotice");

// State
var lastTopResults = null;
var lastIframeResults = null;

/************* Combined helpers *************/
function updateVisibleAddresses() {
  var allResults = [];
  if (lastTopResults && lastTopResults.length) {
    allResults = allResults.concat(lastTopResults);
  }
  if (lastIframeResults && lastIframeResults.length) {
    allResults = allResults.concat(lastIframeResults);
  }
  var addresses = collectAddressesFromResults(allResults);
  renderAddresses(logTopEl, addresses);
}

function allIframeProbesErrored(results) {
  if (!results || !results.length) return false;
  return results.every(function (r) {
    return r && r.error && !Array.isArray(r.accounts);
  });
}

function updateSummary() {
  if (!walletProvidersLineEl || !walletLeakLineEl) return;

  var providersMap = new Map();

  if (lastTopResults && lastTopResults.length) {
    lastTopResults.forEach(function (r) {
      if (!r || !r.wallet) return;
      var name = r.wallet;
      var entry = providersMap.get(name) || {
        inTop: false,
        inIframe: false,
        iframeAccounts: [],
      };
      entry.inTop = true;
      providersMap.set(name, entry);
    });
  }

  if (lastIframeResults && lastIframeResults.length) {
    lastIframeResults.forEach(function (r) {
      if (!r || !r.wallet) return;
      var name = r.wallet;
      var entry = providersMap.get(name) || {
        inTop: false,
        inIframe: false,
        iframeAccounts: [],
      };
      entry.inIframe = true;
      if (Array.isArray(r.accounts)) {
        entry.iframeAccounts = r.accounts;
      }
      providersMap.set(name, entry);
    });
  }

  var entries = Array.from(providersMap.entries());

  if (!entries.length) {
    walletProvidersLineEl.textContent =
      "Wallet providers on this page: none detected.";
    walletLeakLineEl.textContent =
      "In this test, no wallet addresses were learned from any wallets.";
    return;
  }

  var pillHtml = entries
    .map(function ([name, info]) {
      var cls = info.inIframe
        ? "wallet-pill wallet-pill-red"
        : "wallet-pill wallet-pill-green";
      return '<span class="' + cls + '">' + name + "</span>";
    })
    .join(" ");

  walletProvidersLineEl.innerHTML =
    "Wallet providers on this page " +
    "(red = vulnerable in this test, green = not exposed here): " +
    pillHtml;

  var leaking = entries.filter(function ([_, info]) {
    return (
      info.inIframe && info.iframeAccounts && info.iframeAccounts.length > 0
    );
  });

  if (lastIframeResults && allIframeProbesErrored(lastIframeResults)) {
    walletLeakLineEl.textContent =
      "In this browser/setup, the test could not read wallet addresses indirectly (provider calls failed). " +
      "No cross-origin leak is visible here.";
    return;
  }

  if (!leaking.length) {
    walletLeakLineEl.textContent =
      "In this test, no wallet addresses from red wallets were learned indirectly.";
  } else {
    var itemsHtml = leaking
      .map(function ([name, info]) {
        return (
          '<div class="wallet-leak-item">' +
          name +
          " → " +
          info.iframeAccounts.join(", ") +
          "</div>"
        );
      })
      .join("");

    walletLeakLineEl.innerHTML =
      "<div>In this test, the following red wallets exposed addresses to this page:</div>" +
      '<div class="wallet-leak-box">' +
      itemsHtml +
      "</div>";
  }
}

/************* Probes + listeners *************/
async function runTopProbe(contextLabel) {
  try {
    var data = await probeWallets(contextLabel || "top-level");
    lastTopResults = data.results || [];
  } catch (e) {
    console.error("Top-level probe error:", e);
    lastTopResults = [];
  }

  // Toggle no-wallet notice
  if (noWalletNoticeEl) {
    if (
      !lastTopResults.length ||
      (lastTopResults.length === 1 && lastTopResults[0].wallet === "(none)")
    ) {
      noWalletNoticeEl.style.display = "block";
    } else {
      noWalletNoticeEl.style.display = "none";
    }
  }

  updateVisibleAddresses();
  updateSummary();
}

window.addEventListener("message", function (event) {
  var msg = event.data;
  if (!msg || msg.type !== "walletExposureFromIframe") return;

  var payload = msg.payload || {};
  var results = payload.results || [];

  lastIframeResults = results;
  updateVisibleAddresses();
  updateSummary();
});

/************* Init + handlers *************/
(async function () {
  await runTopProbe("initial");
})();

document.getElementById("rerunTopProbe").addEventListener("click", function () {
  runTopProbe("manual");
});

setInterval(function () {
  runTopProbe("auto");
}, 5000);

document.getElementById("openDapp").addEventListener("click", function () {
  window.open("https://dappx.weihongw.com", "_blank", "noopener");
});
