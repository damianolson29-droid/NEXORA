
"use strict";

// ========================================
// NEXORA — live DASHBOARD
// Matches index.html and supabase.js
// live only. No real cryptocurrency is sent.
// ========================================

const PRICES = Object.freeze({
  BTC: 68000,
  ETH: 3200,
  USDT: 1,
  USD: 1
});

const DEFAULT_ASSETS = [
  {
    symbol: "BTC",
    name: "Bitcoin",
    icon: "₿",
    className: "btc",
    balance: 8
  },
  {
    symbol: "ETH",
    name: "Ethereum",
    icon: "◆",
    className: "eth",
    balance: 50
  },
  {
    symbol: "USDT",
    name: "Tether",
    icon: "₮",
    className: "usdt",
    balance: 120000
  },
  {
    symbol: "USD",
    name: "US Dollar",
    icon: "$",
    className: "usd",
    balance: 176000
  }
];

const STORAGE_KEY = "nexora_live_balances_v1";

let assets = loadLocalliveBalances();
let transactions = [];
let selectedAsset = "BTC";
let loading = false;
let accountReady = false;
let accountLoadError = null;

// ========================================
// ELEMENT HELPERS
// ========================================

function byId(id) {
  return document.getElementById(id);
}

function getNexoraClient() {
  const api = window.Nexora;
  const client = window.nexoraSupabase;

  if (!api || !client) {
    throw new Error(
      "Supabase is not loaded. Check index.html script order."
    );
  }

  return { api, client };
}

// ========================================
// LOCAL live BALANCE CACHE
// This cache is NOT authoritative.
// ========================================

function loadLocalliveBalances() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const saved = raw ? JSON.parse(raw) : null;

    if (Array.isArray(saved)) {
      return DEFAULT_ASSETS.map(defaultAsset => {
        const match = saved.find(
          item => item.symbol === defaultAsset.symbol
        );

        const balance = Number(match?.balance);

        return {
          ...defaultAsset,
          balance:
            Number.isFinite(balance) && balance >= 0
              ? balance
              : defaultAsset.balance
        };
      });
    }
  } catch (error) {
    console.warn("", error);
  }

  return DEFAULT_ASSETS.map(asset => ({ ...asset }));
}

function saveLocalliveBalances() {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(
        assets.map(({ symbol, balance }) => ({
          symbol,
          balance
        }))
      )
    );
  } catch (error) {
    console.warn(":", error);
  }
}

// ========================================
// FORMATTING
// ========================================

function formatMoney(amount) {
  const number = Number(amount);

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(Number.isFinite(number) ? number : 0);
}

function formatQuantity(amount, symbol) {
  const number = Number(amount);
  const safeNumber = Number.isFinite(number) ? number : 0;
  const decimals =
    symbol === "USD" || symbol === "USDT" ? 2 : 8;

  return (
    new Intl.NumberFormat("en-US", {
      maximumFractionDigits: decimals
    }).format(safeNumber) +
    " " +
    symbol
  );
}

function getAsset(symbol) {
  return assets.find(asset => asset.symbol === symbol);
}

function getPortfolioValue() {
  return assets.reduce((total, asset) => {
    return total + asset.balance * PRICES[asset.symbol];
  }, 0);
}

// ========================================
// NOTICES
// ========================================

function showNotice(message, type = "info") {
  const notice = byId("notice");
  const noticeText = byId("noticeText");

  if (!notice || !noticeText) {
    console.log(message);
    return;
  }

  noticeText.textContent = message;
  notice.classList.remove("hidden", "success", "error");

  if (type === "success") {
    notice.classList.add("success");
  }

  if (type === "error") {
    notice.classList.add("error");
  }
}

function hideNotice() {
  byId("notice")?.classList.add("hidden");
}

byId("closeNotice")?.addEventListener("click", hideNotice);

// ========================================
// AUTHENTICATION
// Fixes sessionData initialization error.
// ========================================

async function ensureAnonymousSession() {
  const { client } = getNexoraClient();

  const {
    data: sessionData,
    error: sessionError
  } = await client.auth.getSession();

  if (sessionError) {
    throw sessionError;
  }

  if (sessionData.session?.user) {
    console.log(
      "NEXORA active user:",
      sessionData.session.user.id
    );

    return sessionData.session.user;
  }

  const {
    data,
    error
  } = await client.auth.signInAnonymously();

  if (error) {
    throw new Error(
      " " +
      "Authentication > Sign In / Providers > Anonymous. " +
      error.message
    );
  }

  if (!data.user) {
    throw new Error(
      "Supabase did not return an anonymous user."
    );
  }

  console.log("NEXORA new user:", data.user.id);

  return data.user;
}

// ========================================
// NORMALIZE API RESULTS
// ========================================

function normalizeRows(result) {
  if (result?.error) {
    throw result.error;
  }

  if (Array.isArray(result)) {
    return result;
  }

  if (Array.isArray(result?.data)) {
    return result.data;
  }

  return [];
}

// ========================================
// LOAD ACCOUNT
// ========================================

async function refreshAccount() {
  // Prevent overlapping account loads.
  if (loading) {
    return false;
  }

  loading = true;
  accountReady = false;
  accountLoadError = null;

  try {
    const { api } = getNexoraClient();

    // Reuse or create the anonymous Supabase session.
    await ensureAnonymousSession();

    const [balanceResult, transactionResult] =
      await Promise.all([
        api.getBalances(),
        api.getTransactions()
      ]);

    const balanceRows = normalizeRows(balanceResult);
    const transactionRows = normalizeRows(transactionResult);

    // Do not treat an empty balance table as a loaded account.
    if (balanceRows.length === 0) {
      assets = loadLocalliveBalances();
      transactions = transactionRows.map(normalizeTransaction);

      accountReady = false;

      renderAll();

      

      return false;
    }

    // Verify every supported asset has a valid database row.
    const mappedAssets = DEFAULT_ASSETS.map(defaultAsset => {
      const row = balanceRows.find(
        item => item.asset === defaultAsset.symbol
      );

      if (!row) {
        throw new Error(
          "Missing Supabase balance row for " +
          defaultAsset.symbol +
          ". Check the balance creation trigger and table data."
        );
      }

      const balance = Number(row.balance);

      if (!Number.isFinite(balance) || balance < 0) {
        throw new Error(
          "Invalid balance stored for " + defaultAsset.symbol + "."
        );
      }

      return {
        ...defaultAsset,
        balance
      };
    });

    assets = mappedAssets;
    transactions = transactionRows.map(normalizeTransaction);

    accountReady = true;
    saveLocalliveBalances();

    renderAll();

    // Clear a previous notice only after a successful account load.
    hideNotice();

    return true;
  } catch (error) {
    console.error("NEXORA account loading error:", error);

    accountReady = false;
    accountLoadError = error;

    // Never represent cached balances as confirmed server balances.
    assets = loadLocalliveBalances();
    transactions = [];

    renderAll();

    return false;
  } finally {
    loading = false;
  }
}

function normalizeTransaction(row) {
  const amount = Number(row.amount);

  return {
    id: String(row.id ?? ""),
    type:" Live Withdrawal",
    asset: String(row.asset ?? "Unknown"),
    amount: Number.isFinite(amount) ? -Math.abs(amount) : 0,
    status: String(row.status || "Pending").replace(
      /^./,
      character => character.toUpperCase()
    ),
    date: row.created_at
      ? new Date(row.created_at).toLocaleString()
      : "Date unavailable",
    destination: String(row.destination ?? "")
  };
}

// ========================================
// RENDER EVERYTHING
// ========================================

function renderAll() {
  renderPortfolio();

  renderAssets(
    byId("assetSearch")?.value || ""
  );

  renderAllTransactions();
  updateWithdrawAsset();
}

function renderPortfolio() {
  const totalBalance = byId("totalBalance");
  const assetCount = byId("assetCount");
  const transactionCount = byId("transactionCount");

  if (totalBalance) {
    totalBalance.textContent = formatMoney(getPortfolioValue());
  }

  if (assetCount) {
    assetCount.textContent = String(assets.length);
  }

  if (transactionCount) {
    transactionCount.textContent = String(transactions.length);
  }
}

// ========================================
// ASSET TABLE AND SEARCH
// ========================================

function renderAssets(searchTerm = "") {
  const assetList = byId("assetList");

  if (!assetList) {
    return;
  }

  const search = searchTerm.trim().toLowerCase();

  const filteredAssets = assets.filter(asset => {
    return (
      asset.symbol.toLowerCase().includes(search) ||
      asset.name.toLowerCase().includes(search)
    );
  });

  if (filteredAssets.length === 0) {
    assetList.innerHTML =
      '<p class="empty-state">No matching live assets found.</p>';
    return;
  }

  assetList.innerHTML = filteredAssets.map(asset => `
    <button
      type="button"
      class="asset-row ${
        selectedAsset === asset.symbol ? "selected" : ""
      }"
      data-asset="${asset.symbol}"
    >
      <span class="asset-name">
        <span class="coin-icon ${asset.className}">
          ${asset.icon}
        </span>
        <span>
          <strong>${asset.symbol}</strong>
          <small>${asset.name}</small>
        </span>
      </span>

      <span class="asset-balance">
        ${formatQuantity(asset.balance, asset.symbol)}
      </span>

      <span class="asset-price">
        ${formatMoney(PRICES[asset.symbol])}
      </span>

      <span class="asset-value">
        ${formatMoney(
          asset.balance * PRICES[asset.symbol]
        )}
      </span>
    </button>
  `).join("");

  assetList.querySelectorAll("[data-asset]").forEach(button => {
    button.addEventListener("click", () => {
      selectedAsset = button.dataset.asset;

      updateWithdrawAsset();

      renderAssets(
        byId("assetSearch")?.value || ""
      );
    });
  });
}

byId("assetSearch")?.addEventListener("input", event => {
  renderAssets(event.target.value);
});

// ========================================
// TRANSACTION HISTORY
// ========================================

function renderTransactions(containerId, list) {
  const container = byId(containerId);

  if (!container) {
    return;
  }

  if (list.length === 0) {
    container.innerHTML =
      '<p class="empty-state">No  transactions recorded yet.</p>';
    return;
  }

  container.innerHTML = list.map(transaction => {
    const amount = Number(transaction.amount);

    const statusClass =
      transaction.status === "Rejected"
        ? "negative"
        : ["Approved", "Completed"].includes(transaction.status)
          ? "positive"
          : "";

    return `
      <article class="transaction-row">
        <span class="transaction-icon withdraw">↑</span>

        <div class="transaction-description">
          <strong>${escapeHTML(transaction.type)}</strong>
          <small>${escapeHTML(transaction.date)}</small>
          <small>${escapeHTML(transaction.asset)}</small>
        </div>

        <div class="transaction-amount">
          <strong class="${amount < 0 ? "negative" : "positive"}">
            ${formatQuantity(amount, transaction.asset)}
          </strong>

          <small class="transaction-status ${statusClass}">
            ${escapeHTML(transaction.status)}
          </small>
        </div>
      </article>
    `;
  }).join("");
}

function renderAllTransactions() {
  renderTransactions(
    "recentTransactions",
    transactions.slice(0, 5)
  );

  renderTransactions(
    "allTransactions",
    transactions
  );
}

function escapeHTML(value) {
  return String(value).replace(/[&<>"']/g, character => {
    const entities = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    };

    return entities[character];
  });
}

// ========================================
// ILLUSTRATIVE CHART
// Not real market or portfolio performance.
// ========================================

function drawPortfolioChart() {
  const line = byId("chartLine");
  const area = byId("chartArea");
  const grid = byId("chartGrid");

  if (!line || !area || !grid) {
    return;
  }

  const values = [
    34, 38, 35, 47, 43, 55,
    51, 63, 58, 71, 67, 82
  ];

  const width = 700;
  const height = 180;
  const padding = 15;

  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;

  const points = values.map((value, index) => ({
    x: (index / (values.length - 1)) * width,
    y: height - padding -
      ((value - min) / range) * (height - padding * 2)
  }));

  const path = points.map((point, index) => {
    return `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`;
  }).join(" ");

  line.setAttribute("d", path);

  area.setAttribute(
    "d",
    `${path} L ${width} ${height} L 0 ${height} Z`
  );

  grid.innerHTML = [20, 65, 110, 155].map(y => `
    <line
      x1="0"
      y1="${y}"
      x2="${width}"
      y2="${y}"
      stroke="rgba(255,255,255,.08)"
      stroke-dasharray="4 6"
    ></line>
  `).join("");
}

// ========================================
// WITHDRAWAL FORM
// Server-side balance validation is required.
// ========================================

const withdrawForm = byId("withdrawForm");
const withdrawAssetInput = byId("withdrawAsset");
const withdrawAmountInput = byId("withdrawAmount");
const destinationInput = byId("destination");

function updateWithdrawAsset() {
  if (!withdrawAssetInput) {
    return;
  }

  withdrawAssetInput.value = selectedAsset;

  const asset = getAsset(selectedAsset);
  const balanceElement = byId("availableBalance");

  if (balanceElement) {
    balanceElement.textContent = asset
      ? formatQuantity(asset.balance, asset.symbol)
      : "Unavailable";
  }

  updateEstimatedValue();
}

function updateEstimatedValue() {
  const amountInput = byId("withdrawAmount");
  const estimate = byId("estimatedValue");

  if (!amountInput || !estimate) {
    return;
  }

  const amount = Number(amountInput.value);
  const validAmount =
    Number.isFinite(amount) && amount > 0 ? amount : 0;

  estimate.textContent = formatMoney(
    validAmount * (PRICES[selectedAsset] || 0)
  );
}

withdrawAssetInput?.addEventListener("change", event => {
  const requestedAsset = event.target.value;

  if (!Object.prototype.hasOwnProperty.call(
    PRICES,
    requestedAsset
  )) {
    showNotice("Unsupported live asset.", "error");
    updateWithdrawAsset();
    return;
  }

  selectedAsset = requestedAsset;

  updateWithdrawAsset();

  renderAssets(
    byId("assetSearch")?.value || ""
  );
});

withdrawAmountInput?.addEventListener(
  "input",
  updateEstimatedValue
);

withdrawForm?.addEventListener("submit", async event => {
  event.preventDefault();
  hideNotice();

  if (loading) {
    showNotice(
      "Please wait for the current request to finish.",
      "info"
    );
    return;
  }

  const amount = Number(withdrawAmountInput?.value);
  const destination = destinationInput?.value.trim();
  const asset = getAsset(selectedAsset);

  if (!Number.isFinite(amount) || amount <= 0) {
    showNotice(
      "Enter an amount greater than zero.",
      "error"
    );
    return;
  }

  if (!asset || amount > asset.balance) {
    showNotice(
      "The amount exceeds the displayed live balance.",
      "error"
    );
    return;
  }

  if (!destination || destination.length < 6) {
    showNotice(
      "Enter a live destination of at least 6 characters.",
      "error"
    );
    return;
  }

  if (!accountReady) {
    showNotice(
      "Withdrawal is disabled because Supabase balances " +
      "have not been verified. Check your balance rows, " +
      "authentication, and database policies.",
      "error"
    );
    return;
  }

  const submitButton = withdrawForm.querySelector(
    'button[type="submit"]'
  );

  if (submitButton) {
    submitButton.disabled = true;
  }

  loading = true;

  try {
    const { api } = getNexoraClient();

    // This submits a live withdrawal request to Supabase.
    // The server must validate ownership and available balance.
    await api.requestWithdrawal({
      asset: selectedAsset,
      amount,
      destination
    });

    // Do not call refreshAccount() while loading is true.
    // Release the lock before refreshing.
    loading = false;

    const refreshed = await refreshAccount();

    if (!refreshed) {
      showNotice(
        "The request was submitted, but the account could not " +
        "be refreshed. Check transaction history before retrying.",
        "error"
      );
      return;
    }

    withdrawAmountInput.value = "";
    destinationInput.value = "";

    updateEstimatedValue();

    showNotice(
      "live withdrawal request submitted. No cryptocurrency " +
      "was sent. Check transaction history for its status.",
      "success"
    );
  } catch (error) {
    console.error("NEXORA withdrawal error:", error);

    showNotice(
      error.message ||
      "live withdrawal failed. Check Supabase configuration.",
      "error"
    );
  } finally {
    loading = false;

    if (submitButton) {
      submitButton.disabled = false;
    }
  }
});

// ========================================
// NAVIGATION
// Matches every data-page value in index.html.
// ========================================

const pageIds = {
  Dashboard: "dashboardPage",
  Deposit: "depositPage",
  Withdraw: "withdrawPage",
  Exchange: "exchangePage",
  Transactions: "transactionsPage",
  Profile: "profilePage"
};

function navigateTo(page) {
  if (!Object.prototype.hasOwnProperty.call(pageIds, page)) {
    return;
  }

  document.querySelectorAll(".page").forEach(section => {
    section.classList.add("hidden");
  });

  byId(pageIds[page])?.classList.remove("hidden");

  const pageTitle = byId("pageTitle");

  if (pageTitle) {
    pageTitle.textContent = page;
  }

  const welcomeTitle = byId("welcomeTitle");

  if (welcomeTitle) {
    welcomeTitle.textContent =
      page === "Dashboard"
        ? "Welcome to NEXORA live"
        : page;
  }

  document.querySelectorAll("[data-page]").forEach(button => {
    const isActive = button.dataset.page === page;

    button.classList.toggle("active", isActive);

    if (
      button.matches("button") &&
      button.closest(".side-nav")
    ) {
      button.setAttribute(
        "aria-current",
        isActive ? "page" : "false"
      );
    }
  });

  byId("sidebar")?.classList.remove("open");
  hideNotice();

  if (page === "Withdraw") {
    updateWithdrawAsset();
  }

  if (page === "Transactions") {
    renderAllTransactions();
  }

  window.scrollTo({
    top: 0,
    behavior: "smooth"
  });
}

document.querySelectorAll("[data-page]").forEach(button => {
  button.addEventListener("click", event => {
    event.preventDefault();

    const page = button.dataset.page;
    navigateTo(page);

    if (page === "Deposit") {
      showNotice(
        "Deposits are disabled in this live.",
        "info"
      );
    }

    if (page === "Exchange") {
      showNotice(
        "Exchange is disabled in this live.",
        "info"
      );
    }

    if (page === "Profile") {
      showNotice(
        "Profile management is not enabled yet.",
        "info"
      );
    }
  });
});

// ===================================