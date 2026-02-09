// tracker-core.js
// Shared tracker logic for discovering wallet providers,
// probing eth_accounts, and sending results via postMessage.

(function (global) {
  // Discover wallet providers (EIP-6963 first, then window.ethereum fallback)
  async function discoverProviders() {
    const announced = [];
    const onAnnounce = (e) => {
      const d = e?.detail;
      if (d?.provider) announced.push(d);
    };

    window.addEventListener("eip6963:announceProvider", onAnnounce);
    window.dispatchEvent(new Event("eip6963:requestProvider"));
    await new Promise((r) => setTimeout(r, 500));
    window.removeEventListener("eip6963:announceProvider", onAnnounce);

    if (announced.length) {
      const seen = new Set();
      return announced
        .filter((d) => {
          if (seen.has(d.provider)) return false;
          seen.add(d.provider);
          return true;
        })
        .map((d) => ({
          provider: d.provider,
          name: d.info?.name || d.info?.rdns || "wallet",
          info: d.info || {},
        }));
    }

    if (window.ethereum) {
      const list =
        Array.isArray(window.ethereum.providers) &&
        window.ethereum.providers.length
          ? window.ethereum.providers
          : [window.ethereum];
      return list.map((p, i) => ({
        provider: p,
        name: p.isMetaMask
          ? "MetaMask"
          : p.isCoinbaseWallet
            ? "Coinbase"
            : `legacy:${i}`,
        info: {},
      }));
    }

    return [];
  }

  // Probe eth_accounts for all detected providers
  async function trackerProbe(contextLabel) {
    const ps = await discoverProviders();
    const results = [];

    if (!ps.length) {
      results.push({
        wallet: "(none)",
        accounts: null,
        error: "No wallet providers detected",
      });
      return {
        context: contextLabel,
        origin: window.location.origin,
        results,
      };
    }

    for (const w of ps) {
      try {
        const accs = await w.provider.request({
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
          accounts: null,
          error: e.message || String(e),
        });
      }
    }

    return {
      context: contextLabel,
      origin: window.location.origin,
      results,
    };
  }

  // Probe + send via postMessage (used by iframe tracker, dApp page, etc.)
  async function probeAndPost(
    contextLabel,
    targetWindow = window.parent,
    messageType = "walletExposureFromIframe",
  ) {
    const data = await trackerProbe(contextLabel);

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
        console.warn("postMessage to parent failed", e);
      }
    }

    return data;
  }

  // Export a small API on window
  global.walletTracker = {
    discoverProviders,
    trackerProbe,
    probeAndPost,
  };
})(window);
