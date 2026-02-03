// Robinhood Authentication Netlify Function
// Handles OAuth flow with MFA/device verification support
// Stores tokens in Netlify Blobs for persistence

const tokenStore = require('./lib/tokenStore.cjs');

const ROBINHOOD_API_BASE = 'https://api.robinhood.com';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

function generateDeviceToken() {
  if (process.env.RH_DEVICE_TOKEN) {
    return process.env.RH_DEVICE_TOKEN;
  }
  const username = process.env.RH_USER || '';
  let hash = 0;
  for (let i = 0; i < username.length; i++) {
    const char = username.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return `${Math.abs(hash).toString(16).padStart(8, '0')}-0000-0000-0000-000000000000`;
}

/**
 * Initiate authentication with Robinhood.
 * Returns verification requirements if MFA/device approval needed.
 */
async function initiateAuth() {
  const username = process.env.RH_USER;
  const password = process.env.RH_PASS;

  if (!username || !password) {
    throw new Error('RH_USER and RH_PASS environment variables are required');
  }

  // Check if we already have a valid token
  const existingToken = await tokenStore.getToken();
  if (existingToken) {
    const isValid = await tokenStore.validateToken(existingToken);
    if (isValid) {
      return { authenticated: true, message: 'Already authenticated' };
    }
  }

  console.log('[AUTH] Initiating authentication for:', username);

  const response = await fetch(`${ROBINHOOD_API_BASE}/oauth2/token/`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Accept': 'application/json',
    },
    body: new URLSearchParams({
      grant_type: 'password',
      scope: 'internal',
      client_id: 'c82SH0WZOsabOXGP2sxqcj34FxkvfnWRZBKlBjFS',
      username: username,
      password: password,
      device_token: generateDeviceToken(),
    }),
  });

  const data = await response.json();
  console.log('[AUTH] Response status:', response.status);

  // Handle verification workflow (device verification required)
  if (data.verification_workflow) {
    const pendingVerification = {
      workflowId: data.verification_workflow.id,
      status: data.verification_workflow.workflow_status,
      startedAt: Date.now(),
    };
    // Persist to Blobs so it survives cold starts
    await tokenStore.setPendingVerification(pendingVerification);
    return {
      authenticated: false,
      requiresVerification: true,
      verificationType: 'device',
      verificationId: data.verification_workflow.id,
      status: data.verification_workflow.workflow_status,
      message: 'Device verification required. Approve in Robinhood app, then click "Check Verification".',
    };
  }

  // Handle MFA challenge
  if (data.mfa_required || data.challenge) {
    const pendingVerification = {
      mfaRequired: true,
      challengeId: data.challenge?.id,
      challengeType: data.challenge?.type || 'sms',
      startedAt: Date.now(),
    };
    // Persist to Blobs so it survives cold starts
    await tokenStore.setPendingVerification(pendingVerification);
    return {
      authenticated: false,
      requiresMFA: true,
      verificationType: 'mfa',
      challengeType: data.challenge?.type || 'sms',
      message: 'Enter the MFA code from your authenticator app or SMS.',
    };
  }

  // Success - got a token
  if (data.access_token) {
    await tokenStore.setToken(data.access_token, data.refresh_token, data.expires_in || 86400);
    await tokenStore.clearPendingVerification();
    return {
      authenticated: true,
      message: 'Successfully connected to Robinhood!',
    };
  }

  // Unknown error
  console.error('[AUTH] Unexpected response:', JSON.stringify(data));
  throw new Error(data.error_description || data.detail || 'Authentication failed');
}

/**
 * Check if device verification has been approved.
 */
async function checkVerification() {
  const username = process.env.RH_USER;
  const password = process.env.RH_PASS;

  const pendingVerification = await tokenStore.getPendingVerification();
  if (!pendingVerification) {
    return {
      status: 'no_pending',
      message: 'No pending verification. Click "Connect" to start.',
    };
  }

  console.log('[VERIFY] Checking verification status...');

  // Retry auth to see if device was approved
  const response = await fetch(`${ROBINHOOD_API_BASE}/oauth2/token/`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Accept': 'application/json',
    },
    body: new URLSearchParams({
      grant_type: 'password',
      scope: 'internal',
      client_id: 'c82SH0WZOsabOXGP2sxqcj34FxkvfnWRZBKlBjFS',
      username: username,
      password: password,
      device_token: generateDeviceToken(),
    }),
  });

  const data = await response.json();

  // Success - got a token!
  if (data.access_token) {
    await tokenStore.setToken(data.access_token, data.refresh_token, data.expires_in || 86400);
    await tokenStore.clearPendingVerification();
    return {
      status: 'verified',
      authenticated: true,
      message: 'Successfully connected to Robinhood!',
    };
  }

  // Still pending
  if (data.verification_workflow) {
    const elapsed = Math.floor((Date.now() - pendingVerification.startedAt) / 1000);
    return {
      status: 'pending',
      verificationId: data.verification_workflow.id,
      workflowStatus: data.verification_workflow.workflow_status,
      elapsedSeconds: elapsed,
      message: `Waiting for approval... (${elapsed}s)`,
    };
  }

  return {
    status: 'error',
    error: data,
    message: 'Verification check failed. Try connecting again.',
  };
}

/**
 * Submit MFA code.
 */
async function submitMFA(code) {
  const pendingVerification = await tokenStore.getPendingVerification();
  if (!pendingVerification || !pendingVerification.mfaRequired) {
    throw new Error('No pending MFA challenge');
  }

  const username = process.env.RH_USER;
  const password = process.env.RH_PASS;

  console.log('[MFA] Submitting MFA code');

  const response = await fetch(`${ROBINHOOD_API_BASE}/oauth2/token/`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Accept': 'application/json',
    },
    body: new URLSearchParams({
      grant_type: 'password',
      scope: 'internal',
      client_id: 'c82SH0WZOsabOXGP2sxqcj34FxkvfnWRZBKlBjFS',
      username: username,
      password: password,
      device_token: generateDeviceToken(),
      mfa_code: code,
    }),
  });

  const data = await response.json();

  if (data.access_token) {
    await tokenStore.setToken(data.access_token, data.refresh_token, data.expires_in || 86400);
    await tokenStore.clearPendingVerification();
    return {
      authenticated: true,
      message: 'Successfully connected to Robinhood!',
    };
  }

  throw new Error(data.error_description || data.detail || 'MFA verification failed');
}

/**
 * Import a token directly (manual entry from another source).
 */
async function importManualToken(accessToken, refreshToken = null) {
  const result = await tokenStore.importToken(accessToken, refreshToken);
  if (result.success) {
    await tokenStore.clearPendingVerification();
    return {
      authenticated: true,
      message: result.message,
    };
  }
  throw new Error(result.error || 'Token import failed');
}

/**
 * Disconnect - clear stored token.
 */
async function disconnect() {
  await tokenStore.clearToken();
  await tokenStore.clearPendingVerification();
  return {
    authenticated: false,
    message: 'Disconnected from Robinhood',
  };
}

exports.handler = async (event) => {
  // Handle CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: '',
    };
  }

  try {
    const action = event.queryStringParameters?.action || 'status';
    const mfaCode = event.queryStringParameters?.code;

    let result;
    switch (action) {
      case 'status':
        result = await tokenStore.getAuthStatus();
        // Add pending verification info if any
        const pendingVerification = await tokenStore.getPendingVerification();
        if (pendingVerification) {
          result.pendingVerification = {
            type: pendingVerification.mfaRequired ? 'mfa' : 'device',
            elapsedSeconds: Math.floor((Date.now() - pendingVerification.startedAt) / 1000),
          };
        }
        break;

      case 'connect':
      case 'login':
        result = await initiateAuth();
        break;

      case 'verify':
        result = await checkVerification();
        break;

      case 'mfa':
        if (!mfaCode) {
          throw new Error('MFA code required. Use ?action=mfa&code=YOUR_CODE');
        }
        result = await submitMFA(mfaCode);
        break;

      case 'import':
        // Import token from POST body
        if (event.httpMethod !== 'POST') {
          throw new Error('Import requires POST method with JSON body');
        }
        const body = JSON.parse(event.body || '{}');
        if (!body.accessToken) {
          throw new Error('accessToken is required in request body');
        }
        result = await importManualToken(body.accessToken, body.refreshToken);
        break;

      case 'gettoken':
        // Get current token for export
        result = await tokenStore.getTokenData();
        break;

      case 'disconnect':
      case 'logout':
        result = await disconnect();
        break;

      default:
        throw new Error(`Unknown action: ${action}. Available: status, connect, verify, mfa, import, gettoken, disconnect`);
    }

    return {
      statusCode: 200,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(result),
    };
  } catch (error) {
    console.error('Auth error:', error);

    return {
      statusCode: 500,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        authenticated: false,
        error: error.message || 'An error occurred',
      }),
    };
  }
};
