// Plaid Link Netlify Function
// Handles Plaid Link token creation, token exchange, holdings fetch, and disconnect
// Stores access tokens in Netlify Blobs for persistence

const fs = require('fs');
const path = require('path');
const os = require('os');

const LOCAL_TOKEN_FILE = path.join(os.homedir(), '.tokens', 'plaid-blobs.json');
const PLAID_TOKEN_KEY = 'access-token';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

// --- Blob storage (same dual-mode pattern as tokenStore.cjs) ---

function isNetlifyProduction() {
  return !!(process.env.DEPLOY_ID && process.env.SITE_ID);
}

async function getStore() {
  if (!isNetlifyProduction()) {
    return {
      async get(key, options) {
        try {
          if (!fs.existsSync(LOCAL_TOKEN_FILE)) return null;
          const data = JSON.parse(fs.readFileSync(LOCAL_TOKEN_FILE, 'utf8'));
          const value = data[key];
          if (!value) return null;
          return options?.type === 'json' ? value : JSON.stringify(value);
        } catch (e) {
          console.error('[PLAID_STORE] Error reading:', e.message);
          return null;
        }
      },
      async setJSON(key, value) {
        try {
          const dir = path.dirname(LOCAL_TOKEN_FILE);
          if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
          }
          let data = {};
          if (fs.existsSync(LOCAL_TOKEN_FILE)) {
            data = JSON.parse(fs.readFileSync(LOCAL_TOKEN_FILE, 'utf8'));
          }
          data[key] = value;
          fs.writeFileSync(LOCAL_TOKEN_FILE, JSON.stringify(data, null, 2));
        } catch (e) {
          console.error('[PLAID_STORE] Error writing:', e.message);
        }
      },
      async delete(key) {
        try {
          if (!fs.existsSync(LOCAL_TOKEN_FILE)) return;
          const data = JSON.parse(fs.readFileSync(LOCAL_TOKEN_FILE, 'utf8'));
          delete data[key];
          fs.writeFileSync(LOCAL_TOKEN_FILE, JSON.stringify(data, null, 2));
        } catch (e) {
          console.error('[PLAID_STORE] Error deleting:', e.message);
        }
      },
    };
  }

  const { getStore } = await import('@netlify/blobs');
  return getStore('plaid-auth');
}

async function getPlaidToken() {
  const store = await getStore();
  return store.get(PLAID_TOKEN_KEY, { type: 'json' });
}

async function savePlaidToken(accessToken, itemId, institutionName) {
  const store = await getStore();
  await store.setJSON(PLAID_TOKEN_KEY, {
    accessToken,
    itemId,
    institutionName,
    createdAt: new Date().toISOString(),
  });
}

async function clearPlaidToken() {
  const store = await getStore();
  await store.delete(PLAID_TOKEN_KEY);
}

// --- Plaid client ---

function getPlaidClient() {
  const { Configuration, PlaidApi, PlaidEnvironments } = require('plaid');

  const config = new Configuration({
    basePath: PlaidEnvironments[process.env.PLAID_ENV || 'sandbox'],
    baseOptions: {
      headers: {
        'PLAID-CLIENT-ID': process.env.PLAID_CLIENT_ID,
        'PLAID-SECRET': process.env.PLAID_SECRET,
      },
    },
  });

  return new PlaidApi(config);
}

// --- Actions ---

async function createLinkToken() {
  const { Products, CountryCode } = require('plaid');
  const client = getPlaidClient();

  const response = await client.linkTokenCreate({
    user: { client_user_id: 'user-1' },
    client_name: 'Bitcoin Tracker',
    products: [Products.Investments, Products.Transactions],
    country_codes: [CountryCode.Us],
    language: 'en',
  });

  return { linkToken: response.data.link_token };
}

async function exchangeToken(publicToken) {
  const client = getPlaidClient();

  const response = await client.itemPublicTokenExchange({
    public_token: publicToken,
  });

  const { access_token, item_id } = response.data;

  // Try to get institution name
  let institutionName = null;
  try {
    const itemResp = await client.itemGet({ access_token });
    const institutionId = itemResp.data.item.institution_id;
    if (institutionId) {
      const { CountryCode } = require('plaid');
      const instResp = await client.institutionsGetById({
        institution_id: institutionId,
        country_codes: [CountryCode.Us],
      });
      institutionName = instResp.data.institution.name;
    }
  } catch (e) {
    console.warn('[PLAID] Could not fetch institution name:', e.message);
  }

  await savePlaidToken(access_token, item_id, institutionName);

  return {
    connected: true,
    itemId: item_id,
    institutionName,
    message: `Connected${institutionName ? ` to ${institutionName}` : ''}`,
  };
}

async function getStatus() {
  const tokenData = await getPlaidToken();

  if (!tokenData) {
    return {
      connected: false,
      message: 'Not connected',
    };
  }

  return {
    connected: true,
    itemId: tokenData.itemId,
    institutionName: tokenData.institutionName,
    message: `Connected${tokenData.institutionName ? ` to ${tokenData.institutionName}` : ''}`,
  };
}

async function getHoldings() {
  const tokenData = await getPlaidToken();
  if (!tokenData) {
    throw { statusCode: 401, message: 'Not connected. Please link your account first.' };
  }

  const client = getPlaidClient();
  const response = await client.investmentsHoldingsGet({
    access_token: tokenData.accessToken,
  });

  const { accounts, holdings, securities } = response.data;

  // Build security lookup map
  const securitiesMap = {};
  for (const security of securities) {
    securitiesMap[security.security_id] = security;
  }

  // Separate cash-type holdings from investment positions
  let cashTotal = 0;
  const positions = [];

  for (const holding of holdings) {
    const security = securitiesMap[holding.security_id];
    if (!security) continue;

    // Cash-type securities go to cash total
    if (security.type === 'cash' || security.ticker_symbol === 'CUR:USD') {
      cashTotal += holding.institution_value || 0;
      continue;
    }

    if (!holding.quantity || holding.quantity === 0) continue;

    const quantity = holding.quantity;
    const currentPrice = holding.institution_price || security.close_price || 0;
    const averageCost = holding.cost_basis
      ? holding.cost_basis / quantity
      : currentPrice;
    const totalCost = quantity * averageCost;
    const currentValue = holding.institution_value || quantity * currentPrice;
    const gain = currentValue - totalCost;
    const gainPercent = totalCost > 0 ? (gain / totalCost) * 100 : 0;

    positions.push({
      symbol: security.ticker_symbol || security.name || 'Unknown',
      name: security.name || security.ticker_symbol || 'Unknown',
      quantity,
      averageCost: Math.round(averageCost * 100) / 100,
      currentPrice: Math.round(currentPrice * 100) / 100,
      totalCost: Math.round(totalCost * 100) / 100,
      currentValue: Math.round(currentValue * 100) / 100,
      gain: Math.round(gain * 100) / 100,
      gainPercent: Math.round(gainPercent * 100) / 100,
    });
  }

  // Sort by current value descending
  positions.sort((a, b) => b.currentValue - a.currentValue);

  // Use first investment account for account-level info
  const investmentAccount = accounts.find(a => a.type === 'investment') || accounts[0];
  const totalValue = positions.reduce((sum, p) => sum + p.currentValue, 0);
  const buyingPower = investmentAccount?.balances?.available || cashTotal;

  return {
    accountNumber: investmentAccount?.account_id || 'plaid',
    buyingPower: Math.round(buyingPower * 100) / 100,
    cash: Math.round(cashTotal * 100) / 100,
    portfolioValue: Math.round(totalValue * 100) / 100,
    extendedHoursValue: Math.round(totalValue * 100) / 100,
    totalGain: Math.round(positions.reduce((sum, p) => sum + p.gain, 0) * 100) / 100,
    positions,
  };
}

async function disconnect() {
  const tokenData = await getPlaidToken();

  if (tokenData) {
    try {
      const client = getPlaidClient();
      await client.itemRemove({ access_token: tokenData.accessToken });
    } catch (e) {
      console.warn('[PLAID] Error removing item:', e.message);
    }
  }

  await clearPlaidToken();

  return {
    connected: false,
    message: 'Disconnected',
  };
}

// --- Handler ---

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders, body: '' };
  }

  try {
    const action = event.queryStringParameters?.action || 'status';
    let result;

    switch (action) {
      case 'create-link-token':
        result = await createLinkToken();
        break;

      case 'exchange-token': {
        const body = JSON.parse(event.body || '{}');
        if (!body.publicToken) {
          throw { statusCode: 400, message: 'publicToken is required' };
        }
        result = await exchangeToken(body.publicToken);
        break;
      }

      case 'status':
        result = await getStatus();
        break;

      case 'holdings':
        result = await getHoldings();
        break;

      case 'disconnect':
        result = await disconnect();
        break;

      default:
        throw { statusCode: 400, message: `Unknown action: ${action}` };
    }

    return {
      statusCode: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify(result),
    };
  } catch (error) {
    const statusCode = error.statusCode || 500;
    const message = error.message || 'An error occurred';

    console.error('[PLAID] Error:', message);

    return {
      statusCode,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: message }),
    };
  }
};
