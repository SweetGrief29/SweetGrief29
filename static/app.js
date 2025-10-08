// =======================
// Global token registry & chains
// =======================
let TOKENS = [];
const BALANCE_MAP = new Map();
const CHAIN_SPECS = {
  // Add Optimism and Arbitrum EVM specifics
  evm: ["eth", "polygon", "base", "optimism", "arbitrum", "bsc"],
  solana: ["sol"],
  // Disable specific for SVM: empty list
  svm: [],
};


const SYMBOL_ALIASES = {
  USDC: ["USDC.E", "USDBC"],
  "USDC.E": ["USDC", "USDBC"],
  USDBC: ["USDC", "USDC.E"],
};

const SYMBOL_PRIORITY = [
  "USDBC",
  "USDC",
  "USDC.E",
  "BUSD",
  "DAI",
  "USDT",
];

function symbolsEqual(a, b) {
  const ax = String(a || "").toUpperCase();
  const bx = String(b || "").toUpperCase();
  if (!ax && !bx) return true;
  if (ax === bx) return true;
  if ((SYMBOL_ALIASES[ax] || []).includes(bx)) return true;
  if ((SYMBOL_ALIASES[bx] || []).includes(ax)) return true;
  return false;
}

function symbolRank(sym) {
  const upper = String(sym || "").toUpperCase();
  if (!upper) return SYMBOL_PRIORITY.length + 1;
  for (let i = 0; i < SYMBOL_PRIORITY.length; i += 1) {
    if (symbolsEqual(upper, SYMBOL_PRIORITY[i])) return i;
  }
  return SYMBOL_PRIORITY.length + 1;
}

// ===== Trade History Pagination =====
let TRADES = []; // semua data trade dari server
let tradesPage = 1; // halaman aktif
const TRADES_PER_PAGE = 10; // 10 baris per halaman

// =======================
// Helpers
// =======================
function setSpecificOptions(selectEl, chain) {
  if (!selectEl) return "";
  const specs = CHAIN_SPECS[chain] || [];
  const cur = selectEl.value;
  selectEl.innerHTML = specs
    .map((s) => `<option value="${s}">${s}</option>`)
    .join("");
  let next = "";
  if (specs.includes(cur)) {
    next = cur;
  } else if (specs.length > 0) {
    next = specs[0];
  }
  selectEl.value = next;
  return next;
}

function tokenOptionsFor(chain, specific) {
  const hasSpecifics = (CHAIN_SPECS[chain] || []).length > 0;
  const list = (TOKENS || []).filter((t) => {
    const sameChain = String(t.chain || "") === String(chain || "");
    if (!sameChain) return false;
    if (!hasSpecifics || !specific) return true;
    return String(t.specificChain || "") === String(specific || "");
  });
  list.sort((a, b) => {
    const diff = symbolRank(a.symbol) - symbolRank(b.symbol);
    if (diff !== 0) return diff;
    return String(a.symbol || "").localeCompare(String(b.symbol || ""), undefined, { sensitivity: "base" });
  });
  return list
    .map((t) => `<option value="${t.address}" data-specific="${t.specificChain || ""}">${t.symbol} (${t.specificChain || ""})</option>`)
    .join("");
}
function symbolOf(addr) {
  try {
    const a = String(addr || "").toLowerCase();
    const t = (TOKENS || []).find(
      (x) => String(x.address || "").toLowerCase() === a
    );
    if (t && t.symbol) return t.symbol;
    if (a) return a.slice(0, 6) + "…" + a.slice(-4);
    return "";
  } catch (_) {
    return "";
  }
}

function balanceKey(addr, chain, specific) {
  return `${String(chain || "").toLowerCase()}|${String(specific || "").toLowerCase()}|${String(addr || "").toLowerCase()}`;
}

function defaultSpecificForChainValue(chain) {
  const c = String(chain || "").toLowerCase();
  if (!c) return "";
  if (c === "evm") return "eth";
  if (c === "solana") return "sol";
  if (c === "svm") return "svm";
  return "";
}

function resolveSpecificValue(chain, provided) {
  let specific = provided ? String(provided) : "";
  if (specific) return specific;
  const fallback = defaultSpecificForChainValue(chain);
  if (fallback) return fallback;
  const list = CHAIN_SPECS[chain] || [];
  return list && list.length ? list[0] : "";
}

function getBalanceRecord(addr, chain, specific) {
  if (!addr) return { amount: 0, value: 0, symbol: "" };
  const key = balanceKey(addr, chain, specific);
  return BALANCE_MAP.get(key) || { amount: 0, value: 0, symbol: "" };
}

function formatTokenAmount(amount) {
  return Number(amount || 0).toLocaleString("en-US", { maximumFractionDigits: 6 });
}

function formatTokenInputValue(amount) {
  if (!amount || Number.isNaN(amount)) return "";
  return Number(amount)
    .toFixed(8)
    .replace(/\.0+$|(?<=\d)0+$/g, "")
    .replace(/\.$/, "");
}

function getManualTradeContext() {
  const chain = document.getElementById("netChainMan")?.value || "evm";
  const specificSelect = document.getElementById("netSpecificMan");
  const specific = resolveSpecificValue(chain, specificSelect?.value || "");
  const fromToken = document.getElementById("manFromToken")?.value || "";
  let symbol = symbolOf(fromToken);
  const record = getBalanceRecord(fromToken, chain, specific);
  if (!symbol) symbol = record.symbol || "";
  return {
    chain,
    specific,
    fromToken,
    symbol: symbol || "token",
    available: Number(record.amount || 0),
  };
}

let sellControlsBound = false;

function bindSellControls() {
  if (sellControlsBound) return;
  const buttons = document.querySelectorAll('[data-sell-percent]');
  buttons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const percent = Number(btn.dataset.sellPercent || 0);
      if (!percent) return;
      const ctx = getManualTradeContext();
      if (!ctx.fromToken) return;
      if (ctx.available <= 0) {
        const out = document.getElementById('tradeOut');
        if (out) out.textContent = 'Saldo token tidak tersedia untuk dijual.';
        return;
      }
      const input = document.getElementById('amountToken');
      if (input) {
        const amount = ctx.available * (percent / 100);
        input.value = formatTokenInputValue(amount);
        input.dispatchEvent(new Event('input'));
      }
    });
  });
  const customBtn = document.getElementById('btnSellCustom');
  if (customBtn) {
    customBtn.addEventListener('click', () => {
      const input = document.getElementById('amountToken');
      if (input) {
        input.focus();
        input.select();
      }
    });
  }
  const tokenInput = document.getElementById('amountToken');
  if (tokenInput) {
    tokenInput.addEventListener('input', () => {
      const ctx = getManualTradeContext();
      const available = ctx.available;
      const current = Number(tokenInput.value || 0);
      if (available > 0 && current > available) {
        tokenInput.value = formatTokenInputValue(available);
      }
    });
  }
  sellControlsBound = true;
}

function refreshSellAvailability() {
  const side = document.getElementById('side')?.value || 'buy';
  const label = document.getElementById('sellAvailableLabel');
  const symbolSpan = document.getElementById('sellTokenSymbol');
  const input = document.getElementById('amountToken');
  if (!input) return;
  if (side !== 'sell') {
    if (label) label.textContent = '';
    return;
  }
  const ctx = getManualTradeContext();
  const available = ctx.available;
  const symbol = ctx.symbol || 'token';
  if (label) label.textContent = `Available: ${formatTokenAmount(available)} ${symbol}`;
  if (symbolSpan) symbolSpan.textContent = symbol;
  input.dataset.available = String(available || 0);
  input.dataset.symbol = symbol;
}

function updateManualTradeUI() {
  const side = document.getElementById('side')?.value || 'buy';
  const usdGroup = document.getElementById('amountUsdGroup');
  const tokenGroup = document.getElementById('amountTokenGroup');
  if (side === 'sell') {
    usdGroup?.classList.add('d-none');
    tokenGroup?.classList.remove('d-none');
  } else {
    usdGroup?.classList.remove('d-none');
    tokenGroup?.classList.add('d-none');
    const tokenInput = document.getElementById('amountToken');
    if (tokenInput) tokenInput.value = '';
  }
  bindSellControls();
  refreshSellAvailability();
}


function getHideSmallElement() {
  return document.getElementById("hideSmallBalances");
}

function baseHideThreshold() {
  const el = getHideSmallElement();
  return Number(el?.dataset.threshold || "1");
}

function currentMinUsd() {
  const el = getHideSmallElement();
  if (!el) return baseHideThreshold();
  return el.checked ? baseHideThreshold() : 0;
}

function updateHideSmallLabel(minUsdValue) {
  const el = getHideSmallElement();
  const label = document.querySelector('label[for="hideSmallBalances"]');
  if (!el || !label) return;
  const stored = Number(el.dataset.threshold || baseHideThreshold());
  let base = Number(minUsdValue != null ? minUsdValue : stored);
  if (Number.isNaN(base) || base <= 0) {
    base = stored;
  }
  if (!Number.isNaN(base) && base > 0) {
    el.dataset.threshold = String(base);
  }
  if (el.checked) {
    label.textContent = `Hide < $${base.toFixed(2)}`;
  } else {
    label.textContent = 'Show all';
  }
}

function balancesEndpointUrl() {
  const minUsd = currentMinUsd();
  return `/api/balances?minUsd=${encodeURIComponent(minUsd)}`;
}
// formatters
const fmtUSD = (n) =>
  "$" + Number(n || 0).toLocaleString("en-US", { maximumFractionDigits: 2 });
const fmtAmt = (n) =>
  Number(n || 0).toLocaleString("en-US", { maximumFractionDigits: 6 });

// =======================
// Balances table
// =======================
async function loadBalances() {
  const tokenBody = document.getElementById("balancesBody");
  const cashBody = document.getElementById("balancesCashBody");
  const tokenTotalCell = document.getElementById("balancesTokenTotal");
  const cashTotalCell = document.getElementById("balancesCashTotal");
  const alertBox = document.getElementById("balancesAlert");
  if (!tokenBody) return;
  tokenBody.innerHTML = "";
  if (cashBody) cashBody.innerHTML = "";
  alertBox && alertBox.classList.add("d-none");
  try {
    const res = await fetch(balancesEndpointUrl());
    const data = await res.json();
    if (data.error) throw new Error(data.error);

    BALANCE_MAP.clear();
    const tokenRows = [];
    const cashRows = [];
    const toUpper = (sym) => String(sym || "").toUpperCase();
    const isExcludedBalance = (entry) => {
      const upper = toUpper(entry.symbol);
      return upper.includes("USDC.E");
    };
    const isCashBalance = (entry) => {
      if (isExcludedBalance(entry)) return false;
      const upper = toUpper(entry.symbol);
      return upper.includes("USDC") || upper.includes("USDBC");
    };
    const hideSmallAmount = document.getElementById("hideSmallAmount")?.checked;
    const amountThreshold = 1;
    let tokenValueTotal = 0;
    let cashValueTotal = 0;

    (data.balances || []).forEach((b) => {
      if (isExcludedBalance(b)) {
        return;
      }
      const amount = Number(b.amount || 0);
      const valueUsd = Number(b.value || 0);
      const price = b.price != null ? Number(b.price) : null;
      const shouldHideAmount = hideSmallAmount && Math.abs(amount) < amountThreshold;
      const row = {
        html: `
        <td>${b.symbol || ""}</td>
        <td>${b.chain || ""}</td>
        <td>${b.specificChain || ""}</td>
        <td class="text-end">${amount.toLocaleString()}</td>
        <td class="text-end">${price != null ? "$" + price.toFixed(4) : ""}</td>
        <td class="text-end">${b.value != null ? "$" + valueUsd.toFixed(2) : ""}</td>
      `,
        value: valueUsd,
        amount,
      };
      const isCash = isCashBalance(b);
      if (isCash) {
        cashValueTotal += valueUsd;
        if (!shouldHideAmount) {
          cashRows.push(row);
        }
      } else {
        tokenValueTotal += valueUsd;
        if (!shouldHideAmount) {
          tokenRows.push(row);
        }
      }

      if (b.tokenAddress) {
        const key = balanceKey(b.tokenAddress, b.chain, b.specificChain);
        BALANCE_MAP.set(key, {
          amount,
          value: valueUsd,
          symbol: b.symbol || symbolOf(b.tokenAddress) || "",
        });
      }
    });

    const appendRows = (body, rows) => {
      if (!body) return;
      rows.forEach((row) => {
        const tr = document.createElement("tr");
        tr.innerHTML = row.html;
        body.appendChild(tr);
      });
    };

    appendRows(tokenBody, tokenRows);
    appendRows(cashBody, cashRows);

    if (tokenTotalCell) tokenTotalCell.textContent = "$" + tokenValueTotal.toFixed(2);
    if (cashTotalCell) cashTotalCell.textContent = "$" + cashValueTotal.toFixed(2);
  } catch (_) {
    // silent
  }
  refreshSellAvailability();
}




// =======================
// Tokens registry
// =======================
async function loadTokens() {
  const out = document.getElementById("tokensOut");
  if (out) out.textContent = "";
  try {
    const res = await fetch("/api/tokens");
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    TOKENS = data.tokens || [];

    // Rebalance selectors
    const netChainReb = document.getElementById("netChainReb");
    const netSpecReb = document.getElementById("netSpecificReb");
    const rebTarget = document.getElementById("rebTargetToken");
    const rebCash = document.getElementById("rebCashToken");

    // Manual trade selectors
    const netChainMan = document.getElementById("netChainMan");
    const netSpecMan = document.getElementById("netSpecificMan");
    const netChainManTo = document.getElementById("netChainManTo");
    const netSpecManTo = document.getElementById("netSpecificManTo");
    const manFrom = document.getElementById("manFromToken");
    const manTo = document.getElementById("manToToken");

    if (netChainReb && netSpecReb) {
      const opts = tokenOptionsFor(netChainReb.value, netSpecReb.value);
      if (rebTarget) rebTarget.innerHTML = opts;
      if (rebCash) rebCash.innerHTML = opts;

      const pickBySym = (sym) => {
        const hasSpecs = (CHAIN_SPECS[netChainReb.value] || []).length > 0;
        const t = (TOKENS || []).find((x) => {
          const sameChain = String(x.chain || "") === netChainReb.value;
          if (!sameChain) return false;
          const symOk = String(x.symbol || "").toUpperCase() === String(sym || "").toUpperCase();
          if (!symOk) return false;
          if (!hasSpecs || !netSpecReb.value) return true;
          return String(x.specificChain || "") === netSpecReb.value;
        });
        return t ? t.address : "";
      };
      const isSolLike =
        netChainReb.value === "solana" || netChainReb.value === "svm";
      const defCash =
        pickBySym("USDC") || pickBySym("DAI") || pickBySym("USDT");
      const defTarg = pickBySym(isSolLike ? "wSOL" : "WETH");
      if (rebCash && defCash) rebCash.value = defCash;
      if (rebTarget && defTarg) rebTarget.value = defTarg;
    }

    if (netChainMan && netSpecMan) {
      const optsFrom = tokenOptionsFor(netChainMan.value, netSpecMan.value);
      if (manFrom) manFrom.innerHTML = optsFrom;
      const toChainVal = netChainManTo?.value || netChainMan?.value;
      const toSpecVal = netSpecManTo?.value || "";
      let optsTo = tokenOptionsFor(toChainVal, toSpecVal);
      if (!optsTo || optsTo.length === 0) {
        // Fallback: ignore specific and list by chain only (for SVM or empty lists)
        optsTo = tokenOptionsFor(toChainVal, "");
      }
      if (manTo) manTo.innerHTML = optsTo;

      const pickBySymM = (sym) => {
        const t = (TOKENS || []).find(
          (x) =>
            String(x.chain || "") === netChainMan.value &&
            String(x.specificChain || "") === netSpecMan.value &&
            String(x.symbol || "").toUpperCase() ===
              String(sym || "").toUpperCase()
        );
        return t ? t.address : "";
      };
      const pickBySymTo = (sym) => {
        const hasSpecsTo = (CHAIN_SPECS[toChainVal] || []).length > 0;
        const t = (TOKENS || []).find((x) => {
          const sameChain = String(x.chain || "") === String(toChainVal || "");
          if (!sameChain) return false;
          const symOk = String(x.symbol || "").toUpperCase() === String(sym || "").toUpperCase();
          if (!symOk) return false;
          if (!hasSpecsTo || !toSpecVal) return true;
          return String(x.specificChain || "") === String(toSpecVal || "");
        });
        return t ? t.address : "";
      };
      const isSolLikeM =
        netChainMan.value === "solana" || netChainMan.value === "svm";
      const defCashM =
        pickBySymM(isSolLikeM ? "wSOL" : "USDC") ||
        pickBySymM("DAI") ||
        pickBySymM("USDT");
      const defTargM = pickBySymTo(
        (toChainVal === "solana" || toChainVal === "svm") ? "USDC" : "WETH"
      );
      if (manFrom && defCashM) manFrom.value = defCashM;
      if (manTo && defTargM) manTo.value = defTargM;
    }

    const bridgeFromChain = document.getElementById("bridgeFromChain");
    const bridgeFromSpec = document.getElementById("bridgeFromSpecific");
    const bridgeFromToken = document.getElementById("bridgeFromToken");
    const bridgeToChain = document.getElementById("bridgeToChain");
    const bridgeToSpec = document.getElementById("bridgeToSpecific");
    const bridgeToToken = document.getElementById("bridgeToToken");

    const pickBridgeToken = (chainVal, specVal, sym) => {
      const list = (TOKENS || []).filter((x) => {
        if (String(x.chain || "") !== String(chainVal || "")) return false;
        if (specVal) {
          if (String(x.specificChain || "") !== String(specVal || "")) return false;
        }
        return true;
      });
      const target = String(sym || "").toUpperCase();
      const direct = list.find((x) => String(x.symbol || "").toUpperCase() === target);
      if (direct) return direct;
      if (!target) return list[0];
      return list.find((x) => symbolsEqual(x.symbol, sym));
    };

    if (bridgeFromChain && bridgeFromSpec && bridgeFromToken) {
      const prevValue = bridgeFromToken.value;
      const optsFromBridge = tokenOptionsFor(bridgeFromChain.value, bridgeFromSpec.value);
      bridgeFromToken.innerHTML = optsFromBridge;
      const optionValues = Array.from(bridgeFromToken.options || []).map((o) => o.value);
      const specLower = String(bridgeFromSpec.value || "").toLowerCase();
      const fromPreferences = (() => {
        if (bridgeFromChain.value === "solana" || bridgeFromChain.value === "svm") {
          return ["wSOL", "USDC"];
        }
        if (specLower === "base") {
          return ["USDBC", "USDC", "USDC.E", "DAI", "USDT", "WETH"];
        }
        if (specLower === "bsc") {
          return ["USDC", "USDT", "BUSD", "WBNB", "DAI", "WETH"];
        }
        if (specLower === "optimism") {
          return ["USDC", "USDC.E", "DAI", "USDT", "WETH"];
        }
        if (specLower === "arbitrum") {
          return ["USDC", "USDC.E", "DAI", "USDT", "WETH"];
        }
        return ["USDC", "USDT", "DAI", "WETH"];
      })();
      let defFrom = null;
      if (prevValue && optionValues.includes(prevValue)) {
        defFrom = prevValue;
      } else {
        for (const sym of fromPreferences) {
          const hit = pickBridgeToken(bridgeFromChain.value, bridgeFromSpec.value, sym);
          if (hit?.address && optionValues.includes(hit.address)) {
            defFrom = hit.address;
            break;
          }
        }
        if (!defFrom && optionValues.length > 0) {
          defFrom = optionValues[0];
        }
      }
      if (defFrom) bridgeFromToken.value = defFrom;
    }

    if (bridgeToChain && bridgeToSpec && bridgeToToken) {
      const prevValue = bridgeToToken.value;
      const optsToBridge = tokenOptionsFor(bridgeToChain.value, bridgeToSpec.value || "");
      bridgeToToken.innerHTML = optsToBridge;
      const optionValues = Array.from(bridgeToToken.options || []).map((o) => o.value);
      const specLower = String(bridgeToSpec.value || "").toLowerCase();
      const toPreferences = (() => {
        if (bridgeToChain.value === "solana" || bridgeToChain.value === "svm") {
          return ["USDC", "wSOL"];
        }
        if (specLower === "base") {
          return ["USDBC", "USDC", "USDC.E", "DAI", "USDT", "WETH"];
        }
        if (specLower === "bsc") {
          return ["USDC", "USDT", "BUSD", "WBNB", "DAI", "WETH"];
        }
        if (specLower === "optimism") {
          return ["USDC", "USDC.E", "DAI", "USDT", "WETH"];
        }
        if (specLower === "arbitrum") {
          return ["USDC", "USDC.E", "DAI", "USDT", "WETH"];
        }
        return ["USDC", "USDT", "DAI", "WETH"];
      })();
      let defTo = null;
      if (prevValue && optionValues.includes(prevValue)) {
        defTo = prevValue;
      } else {
        for (const sym of toPreferences) {
          const hit = pickBridgeToken(bridgeToChain.value, bridgeToSpec.value, sym);
          if (hit?.address && optionValues.includes(hit.address)) {
            defTo = hit.address;
            break;
          }
        }
        if (!defTo && optionValues.length > 0) {
          defTo = optionValues[0];
        }
      }
      if (defTo) bridgeToToken.value = defTo;
    }

    if (out) out.textContent = `Loaded ${TOKENS.length} tokens.`;
    return TOKENS;
  } catch (e) {
    if (out) out.textContent = "Gagal memuat tokens: " + e.message;
    return [];
  }
}

async function addToken() {
  const sym = document.getElementById("tokSymbol").value.trim();
  const addr = document.getElementById("tokAddress").value.trim();
  const chain = document.getElementById("tokChain").value || "evm";
  let specific = document.getElementById("tokSpecific").value;
  if (!specific) {
    if (chain === "svm") specific = "svm"; else {
      const defs = CHAIN_SPECS[chain] || [];
      specific = defs.length ? defs[0] : "";
    }
  }
  const out = document.getElementById("tokensOut");
  if (out) out.textContent = "Processing...";
  try {
    const res = await fetch("/api/tokens", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        symbol: sym,
        address: addr,
        chain,
        specificChain: specific,
      }),
    });
    const data = await res.json();
    if (!res.ok || data.error)
      throw new Error(data.error || "Add token failed");
    await loadTokens();
    const rebTarget = document.getElementById("rebTargetToken");
    const manTo = document.getElementById("manToToken");
    if (rebTarget) rebTarget.value = addr;
    if (manTo) manTo.value = addr;
    if (out) out.textContent = `Added ${sym} (${specific}).`;
  } catch (e) {
    if (out) out.textContent = "Error: " + e.message;
  } finally {
    refreshSellAvailability();
  }
}

async function removeToken() {
  const sym = document.getElementById("tokSymbol").value.trim();
  const addr = document.getElementById("tokAddress").value.trim();
  const chain = document.getElementById("tokChain").value || "evm";
  let specific = document.getElementById("tokSpecific").value;
  if (!specific) {
    if (chain === "svm") specific = "svm"; else {
      const defs = CHAIN_SPECS[chain] || [];
      specific = defs.length ? defs[0] : "";
    }
  }
  const out = document.getElementById("tokensOut");
  if (out) out.textContent = "Removing...";
  try {
    const payload = addr
      ? { address: addr, chain, specificChain: specific }
      : { symbol: sym, chain, specificChain: specific };
    const res = await fetch("/api/tokens/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok || data.error)
      throw new Error(data.error || "Remove token failed");
    await loadTokens();
    if (out) out.textContent = "Removed.";
  } catch (e) {
    if (out) out.textContent = "Error: " + e.message;
  }
}

// =======================
// Rebalance
// =======================
async function rebalance() {
  const targetPct = Number(document.getElementById("targetPct").value || 10);
  const maxTrade = Number(document.getElementById("maxTrade").value || 500);
  const reserve = Number(document.getElementById("reserve").value || 50);
  const targetToken = document.getElementById("rebTargetToken").value;
  const cashToken = document.getElementById("rebCashToken").value;
  const allowSell = !!document.getElementById("allowSell")?.checked;
  const chain = document.getElementById("netChainReb")?.value || "evm";
  const specificChain =
    document.getElementById("netSpecificReb")?.value || "eth";
  const out = document.getElementById("rebOut");
  if (out) out.textContent = "Processing...";
  try {
    const res = await fetch("/api/rebalance", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        targetPct,
        maxTradeUsd: maxTrade,
        reserveUsd: reserve,
        targetToken,
        cashToken,
        allowSell,
        chain,
        specificChain,
      }),
    });
    const txt = await res.text();
    if (out) out.textContent = txt;
    loadBalances();
    loadTrades();
    loadPnl();
  } catch (e) {
    if (out) out.textContent = "Error: " + e.message;
  }
}

// =======================
// Manual trade
// =======================
async function manualTrade() {
  const side = document.getElementById("side")?.value || "buy";
  const amountUsdInput = document.getElementById("amountUsd");
  const amountTokenInput = document.getElementById("amountToken");
  const amountUsd = Number(amountUsdInput?.value || 0);
  const amountToken = Number(amountTokenInput?.value || 0);
  const fromToken = document.getElementById("manFromToken")?.value;
  const toToken = document.getElementById("manToToken")?.value;
  const chain = document.getElementById("netChainMan")?.value || "evm";
  const specificSelect = document.getElementById("netSpecificMan");
  const specificChain = resolveSpecificValue(chain, specificSelect?.value);
  const toChain = document.getElementById("netChainManTo")?.value || chain;
  const toSpecificSelect = document.getElementById("netSpecificManTo");
  let toSpecificChain = resolveSpecificValue(toChain, toSpecificSelect?.value);
  if ((!toSpecificSelect || !toSpecificSelect.value) && toChain === chain) {
    toSpecificChain = specificChain;
  }
  const reason = document.getElementById("reason")?.value || "manual trade";
  const out = document.getElementById("tradeOut");
  if (out) out.textContent = "Processing...";
  try {
    const payload = {
      side,
      reason,
      fromToken,
      toToken,
      chain,
      specificChain,
      toChain,
      toSpecificChain,
    };

    if (side === "sell") {
      if (!fromToken) throw new Error("Pilih token yang akan dijual.");
      if (amountToken <= 0) throw new Error("Jumlah token harus lebih besar dari 0.");
      payload.amountToken = amountToken;
      payload.amountHuman = amountToken;
    } else {
      if (amountUsd <= 0) throw new Error("Amount USD harus lebih besar dari 0.");
      payload.amountUsd = amountUsd;
    }

    const res = await fetch("/api/manual-trade", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const txt = await res.text();
    if (out) out.textContent = txt;

    await loadBalances();
    await loadTrades();
    await loadPnl();
    refreshSellAvailability();

    try {
      const res2 = await fetch(balancesEndpointUrl());
      const data2 = await res2.json();
      const list = data2.balances || [];
      const focusAddr = side === "buy" ? toToken : fromToken;
      const hit = list.find(
        (b) =>
          String(b.tokenAddress || "").toLowerCase() ===
          String(focusAddr || "").toLowerCase()
      );
      if (hit) {
        const sym = hit.symbol || symbolOf(hit.tokenAddress);
        const line = `\nUpdated balance ${sym}: ${Number(
          hit.amount || 0
        ).toLocaleString()} (USD ${
          hit.value != null ? Number(hit.value).toFixed(2) : "0.00"
        })`;
        if (out) out.textContent += line;
      }
    } catch (_) {}
  } catch (e) {
    if (out) out.textContent = "Error: " + e.message;
  }
}


async function bridgeTokens() {
  const fromChain = document.getElementById("bridgeFromChain")?.value || "evm";
  const fromSpecific = document.getElementById("bridgeFromSpecific")?.value || "";
  const fromToken = document.getElementById("bridgeFromToken")?.value;
  const toChain = document.getElementById("bridgeToChain")?.value || fromChain;
  const toSpecific = document.getElementById("bridgeToSpecific")?.value || "";
  const toToken = document.getElementById("bridgeToToken")?.value;
  const amountUsd = Number(document.getElementById("bridgeAmountUsd")?.value || 0);
  const reason = document.getElementById("bridgeReason")?.value || "bridge";
  const out = document.getElementById("bridgeOut");
  if (out) out.textContent = "Processing...";

  if (!fromToken || !toToken) {
    if (out) out.textContent = "fromToken/toToken belum dipilih";
    return;
  }
  if (!amountUsd || amountUsd <= 0) {
    if (out) out.textContent = "amountUsd harus > 0";
    return;
  }

  const payload = {
    fromToken,
    toToken,
    amountUsd,
    reason,
    fromChain,
    toChain,
  };
  if (fromSpecific) payload.fromSpecificChain = fromSpecific;
  if (toSpecific) payload.toSpecificChain = toSpecific;

  try {
    const res = await fetch("/api/bridge", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const txt = await res.text();
    if (out) out.textContent = txt;
    if (res.ok) {
      await loadBalances();
      await loadTrades();
      await loadPnl();
    }
  } catch (e) {
    if (out) out.textContent = "Error: " + e.message;
  }
}

async function batchTrade() {
  const fromToken = document.getElementById("manFromToken")?.value;
  const toToken = document.getElementById("manToToken")?.value;
  const chain = document.getElementById("netChainMan")?.value || "evm";
  const specificSelect = document.getElementById("netSpecificMan");
  let specificChain =
    specificSelect && specificSelect.value !== undefined
      ? specificSelect.value || ""
      : "";
  if (!specificChain) {
    if (chain === "evm") specificChain = "eth";
    else if (chain === "solana") specificChain = "sol";
    else if (chain === "svm") specificChain = "svm";
  }
  const toChain = document.getElementById("netChainManTo")?.value || chain;
  const toSpecificSelect = document.getElementById("netSpecificManTo");
  let toSpecificChain =
    toSpecificSelect && toSpecificSelect.value !== undefined
      ? toSpecificSelect.value || ""
      : "";
  if (!toSpecificChain) {
    if (toChain === chain) {
      toSpecificChain = specificChain || "";
    } else if (toChain === "evm") toSpecificChain = "eth";
    else if (toChain === "solana") toSpecificChain = "sol";
    else if (toChain === "svm") toSpecificChain = "svm";
  }
  const side = (document.getElementById("batchSide")?.value || "buy").toLowerCase();
  const totalUsdEl = document.getElementById("batchTotalUsd");
  const totalUsdRaw = (totalUsdEl?.value ?? "").trim();
  const totalUsd = totalUsdRaw ? Number(totalUsdRaw) : 0;
  const chunkUsdEl = document.getElementById("batchChunkUsd");
  const chunkUsdRaw = (chunkUsdEl?.value ?? "").trim();
  const chunkUsd = chunkUsdRaw ? Number(chunkUsdRaw) : 0;
  const totalTokenEl = document.getElementById("batchTotalToken");
  const totalTokenRaw = (totalTokenEl?.value ?? "").trim();
  const totalToken = totalTokenRaw ? Number(totalTokenRaw) : 0;
  const chunkTokenEl = document.getElementById("batchChunkToken");
  const chunkTokenRaw = (chunkTokenEl?.value ?? "").trim();
  const chunkToken = chunkTokenRaw ? Number(chunkTokenRaw) : 0;
  const reason = document.getElementById("batchReason")?.value || `batch ${side}`;
  const out = document.getElementById("tradeOut");
  if (out) out.textContent = `Processing batch ${side}...`;
  if (!fromToken || !toToken) {
    if (out) out.textContent = "fromToken/toToken belum dipilih";
    return;
  }
  const useTokenMode =
    side === "sell" && totalTokenRaw !== "" && !Number.isNaN(totalToken) && totalToken > 0;
  if (useTokenMode) {
    if (Number.isNaN(totalToken) || totalToken <= 0) {
      if (out) out.textContent = "totalToken harus > 0";
      return;
    }
    if (chunkTokenRaw && (Number.isNaN(chunkToken) || chunkToken <= 0)) {
      if (out) out.textContent = "chunkToken harus > 0 jika diisi";
      return;
    }
  } else if (side === "sell") {
    if (out) out.textContent = "Isi total token untuk batch sell";
    return;
  } else {
    if (Number.isNaN(totalUsd) || totalUsd <= 0) {
      if (out) out.textContent = "totalUsd harus > 0";
      return;
    }
    if (Number.isNaN(chunkUsd) || chunkUsd <= 0) {
      if (out) out.textContent = "chunkUsd harus > 0";
      return;
    }
  }

  try {
    const payload = {
      side,
      fromToken,
      toToken,
      reason,
      chain,
      specificChain,
      toChain,
      toSpecificChain,
    };
    if (useTokenMode) {
      payload.totalToken = totalToken;
      if (chunkTokenRaw && !Number.isNaN(chunkToken) && chunkToken > 0) {
        payload.chunkToken = chunkToken;
      }
      if (!Number.isNaN(totalUsd) && totalUsd > 0) {
        payload.totalUsd = totalUsd;
      }
      if (!Number.isNaN(chunkUsd) && chunkUsd > 0) {
        payload.chunkUsd = chunkUsd;
      }
    } else {
      payload.totalUsd = totalUsd;
      payload.chunkUsd = chunkUsd;
    }
    const res = await fetch("/api/batch-trade", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const txt = await res.text();
    if (out) out.textContent = txt;
    await loadBalances();
    await loadTrades();
    await loadPnl();
  } catch (e) {
    if (out) out.textContent = "Error: " + e.message;
  }
}





// =======================
// Trade History (with pagination)
// =======================
async function loadTrades() {
  const tbody = document.getElementById("tradesBody");
  const note = document.getElementById("tradesNote");
  if (!tbody) return;
  tbody.innerHTML = "";
  if (note) note.textContent = "";
  try {
    // ambil banyak lalu paginasi di client
    const res = await fetch("/api/trades?limit=100");
    const data = await res.json();
    if (data.error) throw new Error(data.error);

    TRADES = (data.trades || []).sort((a, b) => {
      const tb =
        Date.parse(b.serverTime || b.timestamp || b.createdAt || 0) || 0;
      const ta =
        Date.parse(a.serverTime || a.timestamp || a.createdAt || 0) || 0;
      return tb - ta; // newest first
    });

    tradesPage = 1; // reset ke halaman 1
    renderTrades();
  } catch (e) {
    if (note) note.textContent = "Error loading trades: " + e.message;
  }
}

function renderTrades() {
  const tbody = document.getElementById("tradesBody");
  const note = document.getElementById("tradesNote");
  const pageInfo = document.getElementById("tradesPageInfo"); // opsional (kalau ada di HTML)

  const total = TRADES.length;
  const start = (tradesPage - 1) * TRADES_PER_PAGE;
  const end = Math.min(start + TRADES_PER_PAGE, total);
  const slice = TRADES.slice(start, end);

  const rows = slice
    .map((t) => {
      const amount = t.amountFrom ?? t.amountHuman ?? "";
      const usd = t.tradeUsd ?? t.amountUsd ?? "";
      const fromSym = symbolOf(t.fromToken);
      const toSym = symbolOf(t.toToken);
      const timeStr = (t.serverTime || "").replace("T", " ").replace("Z", "");
      const sideStr = (t.side || "").toLowerCase();
      return `
      <tr>
        <td>${timeStr}</td>
        <td>${t.type || ""}</td>
        <td>${sideStr}</td>
        <td>${fromSym || ""} <span class="text-muted">${(
        t.fromToken || ""
      ).slice(0, 10)}...</span></td>
        <td>${toSym || ""} <span class="text-muted">${(t.toToken || "").slice(
        0,
        10
      )}...</span></td>
        <td class="text-end">${amount !== "" ? fmtAmt(amount) : ""}</td>
        <td class="text-end">${usd !== "" ? fmtUSD(usd) : ""}</td>
        <td>${t.status || (t.success ? "ok" : "error")}</td>
      </tr>`;
    })
    .join("");

  tbody.innerHTML = rows;
  if (pageInfo) {
    pageInfo.textContent = `${total ? start + 1 : 0}–${end} of ${total}`;
  } else if (note) {
    note.textContent = `Showing ${total ? start + 1 : 0}–${end} of ${total}`;
  }

  // enable/disable tombol pager jika ada
  const prev = document.getElementById("tradesPrev");
  const next = document.getElementById("tradesNext");
  if (prev) prev.disabled = tradesPage === 1;
  if (next) next.disabled = end >= total;
}

async function clearTrades() {
  const note = document.getElementById("tradesNote");
  try {
    const res = await fetch("/api/trades/clear", { method: "POST" });
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    await loadTrades();
    if (note) note.textContent = "Cleared.";
  } catch (e) {
    if (note) note.textContent = "Clear failed: " + e.message;
  }
}

// =======================
// PnL
// =======================
async function loadPnl() {
  const posBody = document.getElementById("pnlPositions");
  const cashBody = document.getElementById("pnlCashPositions");
  const rlzBody = document.getElementById("pnlRealized");
  const totalVal = document.getElementById("pnlTotalValue");
  const totalUnrl = document.getElementById("pnlTotalUnreal");
  const cashTotalVal = document.getElementById("pnlCashTotalValue");
  const cashTotalUnrl = document.getElementById("pnlCashTotalUnreal");
  const totalRlz = document.getElementById("pnlTotalRealized");
  if (!posBody || !rlzBody) return;
  posBody.innerHTML = "";
  if (cashBody) cashBody.innerHTML = "";
  rlzBody.innerHTML = "";
  try {
    const res = await fetch("/api/pnl");
    const data = await res.json();
    if (data.error) throw new Error(data.error);

    const positions = data.positions || {};
    const tokenRows = [];
    const cashRows = [];
    const isUsdcSymbol = (sym) => {
      if (!sym) return false;
      const upper = String(sym).toUpperCase();
      return upper.includes("USDC") || upper.includes("USDBC");
    };
    const formatUsd = (val, digits = 2, blankZero = false) => {
      if (val == null || !Number.isFinite(val)) return blankZero ? "" : "$0.00";
      if (Math.abs(val) < 1e-9) return blankZero ? "" : "$0.00";
      return "$" + val.toFixed(digits);
    };
    const makeRow = (p) => {
      const amount = Number(p.amount || 0);
      const avgCost = p.avgCostPerUnitUsd != null ? Number(p.avgCostPerUnitUsd) : null;
      const price = p.marketPriceUsd != null ? Number(p.marketPriceUsd) : null;
      const value = Number(p.marketValueUsd || 0);
      const unreal = Number(p.unrealizedUsd || 0);
      return {
        html: `
        <td>${p.symbol || ""}</td>
        <td class="text-end">${amount.toLocaleString()}</td>
        <td class="text-end">${formatUsd(avgCost, 4, true)}</td>
        <td class="text-end">${formatUsd(price, 4, true)}</td>
        <td class="text-end">${formatUsd(value)}</td>
        <td class="text-end">${formatUsd(unreal)}</td>
      `,
        value: Number.isFinite(value) ? value : 0,
        unreal: Number.isFinite(unreal) ? unreal : 0,
        amount,
      };
    };

    const hideSmallAmount = document.getElementById("hideSmallAmount")?.checked;
    const amountThreshold = 1;
    let tokenValueTotal = 0;
    let tokenUnrealTotal = 0;
    let cashValueTotal = 0;
    let cashUnrealTotal = 0;

    Object.values(positions).forEach((p) => {
      const symUpper = String(p.symbol || "").toUpperCase();
      if (symUpper.includes("USDC.E")) {
        return;
      }
      const amount = Number(p.amount || 0);
      if (amount <= 0) return;
      const row = makeRow(p);
      const shouldHideAmount = hideSmallAmount && amount < amountThreshold;
      if (isUsdcSymbol(p.symbol)) {
        cashValueTotal += row.value;
        cashUnrealTotal += row.unreal;
        if (!shouldHideAmount) {
          cashRows.push(row);
        }
      } else {
        tokenValueTotal += row.value;
        tokenUnrealTotal += row.unreal;
        if (!shouldHideAmount) {
          tokenRows.push(row);
        }
      }
    });

    const appendRows = (body, rows) => {
      if (!body) return;
      rows.forEach((row) => {
        const tr = document.createElement("tr");
        tr.innerHTML = row.html;
        body.appendChild(tr);
      });
    };

    appendRows(posBody, tokenRows);
    appendRows(cashBody, cashRows);

    if (totalVal) totalVal.textContent = "$" + tokenValueTotal.toFixed(2);
    if (totalUnrl) totalUnrl.textContent = "$" + tokenUnrealTotal.toFixed(2);
    if (cashTotalVal) cashTotalVal.textContent = "$" + cashValueTotal.toFixed(2);
    if (cashTotalUnrl) cashTotalUnrl.textContent = "$" + cashUnrealTotal.toFixed(2);

    const realized = data.realized || [];
    realized.forEach((r) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${(r.time || "").replace("T", " " ).replace("Z", "")}</td>
        <td>${r.token || ""}</td>
        <td class="text-end">${Number(r.amount || 0).toLocaleString()}</td>
        <td class="text-end">${
          r.proceedsUsd != null ? "$" + Number(r.proceedsUsd).toFixed(2) : ""
        }</td>
        <td class="text-end">${
          r.costUsd != null ? "$" + Number(r.costUsd).toFixed(2) : ""
        }</td>
        <td class="text-end">${
          r.pnlUsd != null ? "$" + Number(r.pnlUsd).toFixed(2) : ""
        }</td>
      `;
      rlzBody.appendChild(tr);
    });

    const stats = data.stats || {};
    if (totalRlz)
      totalRlz.textContent =
        "$" + Number(stats.realizedUsd || 0).toFixed(2);
  } catch (_) {
    // silent
  }
}


// =======================
// PnL Live updater
// =======================
let PNL_TIMER = null;
let PNL_LOADING = false;

function startPnlLive() {
  const secInput = document.getElementById("pnlLiveSec");
  let sec = Number(secInput?.value || 15);
  if (!Number.isFinite(sec) || sec < 5) sec = 15;
  stopPnlLive();
  PNL_TIMER = setInterval(async () => {
    if (PNL_LOADING) return;
    try {
      PNL_LOADING = true;
      await loadPnl();
    } finally {
      PNL_LOADING = false;
    }
  }, sec * 1000);
}

function stopPnlLive() {
  if (PNL_TIMER) {
    clearInterval(PNL_TIMER);
    PNL_TIMER = null;
  }
}

function initPnlLive() {
  const toggle = document.getElementById("pnlLiveToggle");
  const secInput = document.getElementById("pnlLiveSec");
  if (toggle) {
    toggle.addEventListener("change", () => {
      if (toggle.checked) startPnlLive();
      else stopPnlLive();
    });
  }
  if (secInput) {
    secInput.addEventListener("change", () => {
      if (toggle?.checked) startPnlLive();
    });
  }
  // Pause when tab hidden
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) stopPnlLive();
    else if (toggle?.checked) startPnlLive();
  });
  // Start by default if toggle is on
  if (toggle?.checked) startPnlLive();
}

// =======================
// AI Suggestion / Status
// =======================
async function aiSuggest() {
  const out = document.getElementById("rebOut");
  if (out) out.textContent = "AI analyzing...";
  try {
    const res = await fetch("/api/ai/suggest-rebalance");
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    if (data.targetPct)
      document.getElementById("targetPct").value = Number(data.targetPct);
    if (data.targetToken)
      document.getElementById("rebTargetToken").value = data.targetToken;
    if (data.cashToken)
      document.getElementById("rebCashToken").value = data.cashToken;
    if (out) out.textContent = JSON.stringify(data, null, 2);
  } catch (e) {
    if (out) out.textContent = "AI Error: " + e.message;
  }
}

async function checkAIStatus() {
  const el = document.getElementById("aiStatus");
  if (!el) return;
  el.textContent = "Checking AI...";
  try {
    const res = await fetch("/api/ai/status?test=1");
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    if (data.available && data.hasKey) {
      el.textContent = `AI ready (${data.model})`;
      el.classList.remove("text-danger");
      el.classList.add("text-success");
    } else if (!data.hasKey) {
      el.textContent = "AI not configured (missing OPENAI_API_KEY)";
      el.classList.remove("text-success");
      el.classList.add("text-danger");
    } else {
      el.textContent = "AI module not available";
      el.classList.remove("text-success");
      el.classList.add("text-danger");
    }
  } catch (e) {
    el.textContent = "AI check error: " + e.message;
    el.classList.remove("text-success");
    el.classList.add("text-danger");
  }
}

// =======================
// Event listeners
// =======================
document.getElementById("hideSmallAmount")?.addEventListener("change", () => {
  loadBalances();
  loadPnl();
});
document.getElementById("btnRefresh")?.addEventListener("click", loadBalances);
document.getElementById("side")?.addEventListener("change", updateManualTradeUI);
document.getElementById("manFromToken")?.addEventListener("change", refreshSellAvailability);
document.getElementById("netChainMan")?.addEventListener("change", () => {
  updateManualTradeUI();
});
document.getElementById("netSpecificMan")?.addEventListener("change", refreshSellAvailability);
document.getElementById("netChainManTo")?.addEventListener("change", refreshSellAvailability);
document.getElementById("netSpecificManTo")?.addEventListener("change", refreshSellAvailability);
document.getElementById("hideSmallBalances")?.addEventListener("change", () => {
  updateHideSmallLabel(currentMinUsd());
  loadBalances();
});
document.getElementById("btnRebalance")?.addEventListener("click", rebalance);
document.getElementById("btnAISuggest")?.addEventListener("click", aiSuggest);
document.getElementById("btnExecute")?.addEventListener("click", manualTrade);
document.getElementById("btnBatchTrade")?.addEventListener("click", batchTrade);
document.getElementById("btnBridge")?.addEventListener("click", bridgeTokens);
document.getElementById("batchSide")?.addEventListener("change", (evt) => {
  const target = evt.target || evt.currentTarget;
  const sideVal = String(target?.value || "").toLowerCase();
  const input = document.getElementById("batchReason");
  if (input) {
    const preset = String(input.value || "").toLowerCase();
    if (!preset || preset.startsWith("batch ")) {
      input.value = `batch ${sideVal}`;
    }
  }
  const tokenGroup = document.getElementById("batchTokenGroup");
  const chunkTokenGroup = document.getElementById("batchChunkTokenGroup");
  const totalTokenInput = document.getElementById("batchTotalToken");
  const chunkTokenInput = document.getElementById("batchChunkToken");
  const totalUsdGroup = document.getElementById("batchTotalUsdGroup");
  const chunkUsdGroup = document.getElementById("batchChunkUsdGroup");
  const totalUsdInput = document.getElementById("batchTotalUsd");
  const chunkUsdInput = document.getElementById("batchChunkUsd");
  const showToken = sideVal === "sell";
  const showUsd = sideVal !== "sell";
  [tokenGroup, chunkTokenGroup].forEach((el) => {
    if (!el) return;
    el.classList.toggle("d-none", !showToken);
  });
  [totalUsdGroup, chunkUsdGroup].forEach((el) => {
    if (!el) return;
    el.classList.toggle("d-none", !showUsd);
  });
  if (!showToken) {
    if (totalTokenInput) totalTokenInput.value = "";
    if (chunkTokenInput) chunkTokenInput.value = "";
  }
  if (!showUsd) {
    if (totalUsdInput) totalUsdInput.value = "";
    if (chunkUsdInput) chunkUsdInput.value = "";
  } else {
    if (totalUsdInput && !totalUsdInput.value) totalUsdInput.value = "100";
    if (chunkUsdInput && !chunkUsdInput.value) chunkUsdInput.value = "1";
  }
});
const batchSideEl = document.getElementById("batchSide");
if (batchSideEl) {
  batchSideEl.dispatchEvent(new Event("change"));
}
document.getElementById("btnAddToken")?.addEventListener("click", addToken);
document
  .getElementById("btnRemoveToken")
  ?.addEventListener("click", removeToken);

document
  .getElementById("btnReloadTokens")
  ?.addEventListener("click", loadTokens);
document
  .getElementById("btnTradesRefresh")
  ?.addEventListener("click", loadTrades);
document
  .getElementById("btnTradesClear")
  ?.addEventListener("click", clearTrades);
document.getElementById("btnPnlRefresh")?.addEventListener("click", loadPnl);

// Pager buttons for Trade History
document.getElementById("tradesPrev")?.addEventListener("click", () => {
  if (tradesPage > 1) {
    tradesPage--;
    renderTrades();
  }
});
document.getElementById("tradesNext")?.addEventListener("click", () => {
  if (tradesPage * TRADES_PER_PAGE < TRADES.length) {
    tradesPage++;
    renderTrades();
  }
});

// Swap tokens (manual trade)
document.getElementById("btnSwap")?.addEventListener("click", () => {
  const fromSel = document.getElementById("manFromToken");
  const toSel = document.getElementById("manToToken");
  if (!fromSel || !toSel) return;
  const tmp = fromSel.value;
  fromSel.value = toSel.value;
  toSel.value = tmp;
});

// =======================
// Network selection handlers
// =======================
function initNetworkSelectors() {
  const netChainReb = document.getElementById("netChainReb");
  const netSpecReb = document.getElementById("netSpecificReb");
  const netChainMan = document.getElementById("netChainMan");
  const netSpecMan = document.getElementById("netSpecificMan");
  const netChainManTo = document.getElementById("netChainManTo");
  const netSpecManTo = document.getElementById("netSpecificManTo");
  const tokChain = document.getElementById("tokChain");
  const tokSpecific = document.getElementById("tokSpecific");
  const tokAddress = document.getElementById("tokAddress");
  const bridgeFromChain = document.getElementById("bridgeFromChain");
  const bridgeFromSpec = document.getElementById("bridgeFromSpecific");
  const bridgeToChain = document.getElementById("bridgeToChain");
  const bridgeToSpec = document.getElementById("bridgeToSpecific");

  if (netChainReb && netSpecReb) {
    setSpecificOptions(netSpecReb, netChainReb.value);
    netSpecReb.disabled = (CHAIN_SPECS[netChainReb.value] || []).length === 0;
    netChainReb.addEventListener("change", async () => {
      setSpecificOptions(netSpecReb, netChainReb.value);
      netSpecReb.disabled = (CHAIN_SPECS[netChainReb.value] || []).length === 0;
      await loadTokens();
      if (tokChain && tokSpecific) {
        tokChain.value = netChainReb.value;
        setSpecificOptions(tokSpecific, tokChain.value);
        if (tokAddress)
          tokAddress.placeholder =
            tokChain.value === "evm" ? "0x... (EVM)" : "base58 (Solana/SVM)";
      }
    });
    netSpecReb.addEventListener("change", loadTokens);
  }

  if (netChainMan && netSpecMan) {
    setSpecificOptions(netSpecMan, netChainMan.value);
    netSpecMan.disabled = (CHAIN_SPECS[netChainMan.value] || []).length === 0;
    netChainMan.addEventListener("change", async () => {
      setSpecificOptions(netSpecMan, netChainMan.value);
      netSpecMan.disabled = (CHAIN_SPECS[netChainMan.value] || []).length === 0;
      await loadTokens();
      if (tokChain && tokSpecific) {
        tokChain.value = netChainMan.value;
        setSpecificOptions(tokSpecific, tokChain.value);
        if (tokAddress)
          tokAddress.placeholder =
            tokChain.value === "evm" ? "0x... (EVM)" : "base58 (Solana/SVM)";
      }
    });
    netSpecMan.addEventListener("change", loadTokens);
  }

  if (netChainManTo && netSpecManTo) {
    setSpecificOptions(netSpecManTo, netChainManTo.value);
    netSpecManTo.disabled = (CHAIN_SPECS[netChainManTo.value] || []).length === 0;
    netChainManTo.addEventListener("change", async () => {
      setSpecificOptions(netSpecManTo, netChainManTo.value);
      netSpecManTo.disabled = (CHAIN_SPECS[netChainManTo.value] || []).length === 0;
      // For chains without specifics (svm), clear value; otherwise keep first
      const defaults = (CHAIN_SPECS[netChainManTo.value] || []);
      netSpecManTo.value = defaults[0] || "";
      // Repopulate To tokens immediately using chain-only if needed
      const manTo = document.getElementById("manToToken");
      if (manTo) {
        manTo.innerHTML = tokenOptionsFor(netChainManTo.value, netSpecManTo.value || "");
      }
      await loadTokens();
    });
    netSpecManTo.addEventListener("change", async () => {
      const manTo = document.getElementById("manToToken");
      if (manTo) {
        manTo.innerHTML = tokenOptionsFor(netChainManTo.value, netSpecManTo.value || "");
      }
      await loadTokens();
    });
  }

  // No separate destination chain for manual trade in UI

  if (bridgeFromChain && bridgeFromSpec) {
    setSpecificOptions(bridgeFromSpec, bridgeFromChain.value);
    bridgeFromSpec.disabled = (CHAIN_SPECS[bridgeFromChain.value] || []).length === 0;
    if (bridgeFromChain.value === "svm") {
      bridgeFromSpec.disabled = false;
      bridgeFromSpec.innerHTML = "<option value='svm'>svm</option>";
      bridgeFromSpec.value = "svm";
    } else if (bridgeFromSpec.disabled) {
      bridgeFromSpec.value = "";
    } else if (!bridgeFromSpec.value) {
      const defs = CHAIN_SPECS[bridgeFromChain.value] || [];
      bridgeFromSpec.value = defs[0] || "";
    }
    bridgeFromChain.addEventListener("change", async () => {
      setSpecificOptions(bridgeFromSpec, bridgeFromChain.value);
      bridgeFromSpec.disabled = (CHAIN_SPECS[bridgeFromChain.value] || []).length === 0;
      if (bridgeFromChain.value === "svm") {
        bridgeFromSpec.disabled = false;
        bridgeFromSpec.innerHTML = "<option value='svm'>svm</option>";
        bridgeFromSpec.value = "svm";
      } else if (bridgeFromSpec.disabled) {
        bridgeFromSpec.value = "";
      } else if (!bridgeFromSpec.value) {
        const defs = CHAIN_SPECS[bridgeFromChain.value] || [];
        bridgeFromSpec.value = defs[0] || "";
      }
      await loadTokens();
    });
    bridgeFromSpec.addEventListener("change", loadTokens);
  }

  if (bridgeToChain && bridgeToSpec) {
    setSpecificOptions(bridgeToSpec, bridgeToChain.value);
    bridgeToSpec.disabled = (CHAIN_SPECS[bridgeToChain.value] || []).length === 0;
    if (bridgeToChain.value === "svm") {
      bridgeToSpec.disabled = false;
      bridgeToSpec.innerHTML = "<option value='svm'>svm</option>";
      bridgeToSpec.value = "svm";
    } else if (bridgeToSpec.disabled) {
      bridgeToSpec.value = "";
    } else if (!bridgeToSpec.value) {
      const defs = CHAIN_SPECS[bridgeToChain.value] || [];
      bridgeToSpec.value = defs[0] || "";
    }
    bridgeToChain.addEventListener("change", async () => {
      setSpecificOptions(bridgeToSpec, bridgeToChain.value);
      bridgeToSpec.disabled = (CHAIN_SPECS[bridgeToChain.value] || []).length === 0;
      if (bridgeToChain.value === "svm") {
        bridgeToSpec.disabled = false;
        bridgeToSpec.innerHTML = "<option value='svm'>svm</option>";
        bridgeToSpec.value = "svm";
      } else if (bridgeToSpec.disabled) {
        bridgeToSpec.value = "";
      } else if (!bridgeToSpec.value) {
        const defs = CHAIN_SPECS[bridgeToChain.value] || [];
        bridgeToSpec.value = defs[0] || "";
      }
      await loadTokens();
    });
    bridgeToSpec.addEventListener("change", loadTokens);
  }

  // No separate destination chain for manual trade in UI

  if (tokChain && tokSpecific) {
    setSpecificOptions(tokSpecific, tokChain.value);
    tokSpecific.disabled = (CHAIN_SPECS[tokChain.value] || []).length === 0;
    // Manage Tokens: always allow selecting specific for SVM
    if (tokChain.value === "svm") {
      tokSpecific.disabled = false;
      tokSpecific.innerHTML = '<option value="svm">svm</option>';
      tokSpecific.value = "svm";
    } else if (tokSpecific.disabled) {
      tokSpecific.value = "";
    }
    tokChain.addEventListener("change", () =>
      { setSpecificOptions(tokSpecific, tokChain.value);
        tokSpecific.disabled = (CHAIN_SPECS[tokChain.value] || []).length === 0;
        if (tokChain.value === "svm") {
          tokSpecific.disabled = false;
          tokSpecific.innerHTML = '<option value="svm">svm</option>';
          tokSpecific.value = "svm";
        } else if (tokSpecific.disabled) {
          tokSpecific.value = "";
        } }
    );
    if (tokAddress)
      tokAddress.placeholder =
        tokChain.value === "evm" ? "0x... (EVM)" : "base58 (Solana/SVM)";
  }
}

// =======================
// Initial load
// =======================
initNetworkSelectors();
updateHideSmallLabel();
loadBalances();
loadTokens();
loadTrades();
loadPnl();
checkAIStatus();
initPnlLive();
