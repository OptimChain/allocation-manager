import { useState, useEffect, useCallback } from 'react';
import {
  RefreshCw,
  TrendingUp,
  TrendingDown,
  DollarSign,
  Activity,
  AlertTriangle,
  CheckCircle,
  XCircle,
  Bot,
  BarChart3,
  Link,
  Unlink,
  Loader2,
  Shield,
  Copy,
} from 'lucide-react';
import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  Tooltip,
  Legend,
} from 'recharts';
import {
  getPortfolio,
  getBotActions,
  analyzePortfolio,
  getAuthStatus,
  connectRobinhood,
  checkVerification,
  submitMFA,
  disconnectRobinhood,
  importToken,
  getStoredToken,
  Portfolio,
  BotAction,
  BotAnalysis,
  AuthStatus,
  formatCurrency,
  formatPercent,
  getGainColor,
} from '../services/robinhoodService';

const COLORS = [
  '#3B82F6', // blue
  '#10B981', // green
  '#F59E0B', // yellow
  '#EF4444', // red
  '#8B5CF6', // purple
  '#EC4899', // pink
  '#06B6D4', // cyan
  '#F97316', // orange
];

// Auth Panel Component
function AuthPanel({
  authStatus,
  onAuthChange,
}: {
  authStatus: AuthStatus | null;
  onAuthChange: () => void;
}) {
  const [connecting, setConnecting] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [mfaCode, setMfaCode] = useState('');
  const [tokenInput, setTokenInput] = useState('');
  const [storedToken, setStoredToken] = useState<string | null>(null);
  const [authState, setAuthState] = useState<'idle' | 'device' | 'mfa' | 'token'>('idle');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const handleConnect = async () => {
    setConnecting(true);
    setError(null);
    setMessage(null);

    try {
      const result = await connectRobinhood();

      if (result.authenticated) {
        setMessage(result.message);
        setAuthState('idle');
        onAuthChange();
      } else if (result.requiresVerification) {
        setAuthState('device');
        setMessage(result.message || 'Approve in Robinhood app');
      } else if (result.requiresMFA) {
        setAuthState('mfa');
        setMessage(result.message || 'Enter MFA code');
      } else {
        setError(result.error || 'Connection failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connection failed');
    } finally {
      setConnecting(false);
    }
  };

  const handleVerify = async () => {
    setVerifying(true);
    setError(null);

    try {
      const result = await checkVerification();

      if (result.authenticated) {
        setMessage(result.message || 'Connected!');
        setAuthState('idle');
        onAuthChange();
      } else if (result.status === 'pending') {
        setMessage(`Waiting for approval... (${result.elapsedSeconds}s)`);
      } else {
        setError(result.message || 'Verification failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Verification failed');
    } finally {
      setVerifying(false);
    }
  };

  const handleMFA = async () => {
    if (!mfaCode.trim()) return;

    setConnecting(true);
    setError(null);

    try {
      const result = await submitMFA(mfaCode.trim());

      if (result.authenticated) {
        setMessage(result.message || 'Connected!');
        setAuthState('idle');
        setMfaCode('');
        onAuthChange();
      } else {
        setError(result.error || 'MFA failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'MFA failed');
    } finally {
      setConnecting(false);
    }
  };

  const handleDisconnect = async () => {
    setConnecting(true);
    try {
      await disconnectRobinhood();
      setAuthState('idle');
      setMessage(null);
      onAuthChange();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Disconnect failed');
    } finally {
      setConnecting(false);
    }
  };

  const handleTokenImport = async () => {
    if (!tokenInput.trim()) return;

    setConnecting(true);
    setError(null);

    try {
      const result = await importToken(tokenInput.trim());

      if (result.authenticated) {
        setMessage(result.message || 'Token imported!');
        setAuthState('idle');
        setTokenInput('');
        setStoredToken(null);
        onAuthChange();
      } else {
        setError(result.error || 'Token import failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Token import failed');
    } finally {
      setConnecting(false);
    }
  };

  const handleShowToken = async () => {
    setAuthState('token');
    setError(null);
    setStoredToken(null);

    try {
      const data = await getStoredToken();
      if (data.hasToken && data.accessToken) {
        setStoredToken(data.accessToken);
      }
    } catch (err) {
      // Ignore errors - user can still paste a token manually
    }
  };

  const handleCopyToken = async () => {
    if (!storedToken) return;
    try {
      await navigator.clipboard.writeText(storedToken);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      setError('Failed to copy to clipboard');
    }
  };

  const isConnected = authStatus?.authenticated;

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4 mb-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className={`p-2 rounded-lg ${isConnected ? 'bg-green-100' : 'bg-gray-100'}`}>
            <Shield className={`w-5 h-5 ${isConnected ? 'text-green-600' : 'text-gray-400'}`} />
          </div>
          <div>
            <h3 className="font-medium text-gray-900">Robinhood Connection</h3>
            <p className="text-sm text-gray-500">
              {isConnected
                ? `Connected • Expires in ${Math.floor((authStatus?.expiresIn || 0) / 3600)}h`
                : 'Not connected'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Show different UI based on auth state */}
          {authState === 'idle' && (
            <>
              {isConnected ? (
                <button
                  onClick={handleDisconnect}
                  disabled={connecting}
                  className="flex items-center gap-2 px-4 py-2 text-red-600 border border-red-200 rounded-lg hover:bg-red-50 disabled:opacity-50"
                >
                  <Unlink className="w-4 h-4" />
                  Disconnect
                </button>
              ) : (
                <>
                  <button
                    onClick={handleConnect}
                    disabled={connecting}
                    className="flex items-center gap-2 px-4 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600 disabled:opacity-50"
                  >
                    {connecting ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Link className="w-4 h-4" />
                    )}
                    Generate Token
                  </button>
                  <button
                    onClick={handleShowToken}
                    className="flex items-center gap-2 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50"
                  >
                    <Shield className="w-4 h-4" />
                    Use Token
                  </button>
                </>
              )}
            </>
          )}

          {authState === 'device' && (
            <div className="flex items-center gap-2">
              <span className="text-sm text-yellow-600">Approve in Robinhood app</span>
              <button
                onClick={handleVerify}
                disabled={verifying}
                className="flex items-center gap-2 px-4 py-2 bg-yellow-500 text-white rounded-lg hover:bg-yellow-600 disabled:opacity-50"
              >
                {verifying ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <RefreshCw className="w-4 h-4" />
                )}
                Check
              </button>
              <button
                onClick={() => setAuthState('idle')}
                className="px-3 py-2 text-gray-500 hover:text-gray-700"
              >
                Cancel
              </button>
            </div>
          )}

          {authState === 'mfa' && (
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={mfaCode}
                onChange={(e) => setMfaCode(e.target.value)}
                placeholder="MFA Code"
                className="w-32 px-3 py-2 border border-gray-300 rounded-lg text-center"
                maxLength={6}
              />
              <button
                onClick={handleMFA}
                disabled={connecting || !mfaCode.trim()}
                className="flex items-center gap-2 px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50"
              >
                {connecting ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <CheckCircle className="w-4 h-4" />
                )}
                Submit
              </button>
              <button
                onClick={() => {
                  setAuthState('idle');
                  setMfaCode('');
                }}
                className="px-3 py-2 text-gray-500 hover:text-gray-700"
              >
                Cancel
              </button>
            </div>
          )}

          {authState === 'token' && (
            <div className="flex items-center gap-2">
              {storedToken && (
                <button
                  onClick={handleCopyToken}
                  className={`flex items-center gap-2 px-3 py-2 border rounded-lg text-sm ${
                    copied
                      ? 'border-green-300 bg-green-50 text-green-700'
                      : 'border-gray-300 text-gray-700 hover:bg-gray-50'
                  }`}
                  title="Copy stored token"
                >
                  {copied ? (
                    <>
                      <CheckCircle className="w-4 h-4" />
                      Copied
                    </>
                  ) : (
                    <>
                      <Copy className="w-4 h-4" />
                      Copy Token
                    </>
                  )}
                </button>
              )}
              <input
                type="password"
                value={tokenInput}
                onChange={(e) => setTokenInput(e.target.value)}
                placeholder={storedToken ? 'Paste new token to replace' : 'Paste access token'}
                className="w-64 px-3 py-2 border border-gray-300 rounded-lg text-sm font-mono"
              />
              <button
                onClick={handleTokenImport}
                disabled={connecting || !tokenInput.trim()}
                className="flex items-center gap-2 px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50"
              >
                {connecting ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <CheckCircle className="w-4 h-4" />
                )}
                Import
              </button>
              <button
                onClick={() => {
                  setAuthState('idle');
                  setTokenInput('');
                  setStoredToken(null);
                }}
                className="px-3 py-2 text-gray-500 hover:text-gray-700"
              >
                Cancel
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Messages */}
      {message && (
        <div className="mt-3 p-2 bg-green-50 border border-green-200 rounded text-sm text-green-700">
          {message}
        </div>
      )}
      {error && (
        <div className="mt-3 p-2 bg-red-50 border border-red-200 rounded text-sm text-red-700">
          {error}
        </div>
      )}
    </div>
  );
}

function PortfolioSummary({ portfolio }: { portfolio: Portfolio }) {
  const dayGainPercent = portfolio.portfolioValue > 0
    ? (portfolio.totalGain / (portfolio.portfolioValue - portfolio.totalGain)) * 100
    : 0;

  return (
    <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <div className="flex items-center gap-2 text-gray-500 text-sm mb-1">
          <DollarSign className="w-4 h-4" />
          Portfolio Value
        </div>
        <div className="text-2xl font-bold text-gray-900">
          {formatCurrency(portfolio.portfolioValue)}
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <div className="flex items-center gap-2 text-gray-500 text-sm mb-1">
          {portfolio.totalGain >= 0 ? (
            <TrendingUp className="w-4 h-4 text-green-500" />
          ) : (
            <TrendingDown className="w-4 h-4 text-red-500" />
          )}
          Day's Change
        </div>
        <div className={`text-2xl font-bold ${getGainColor(portfolio.totalGain)}`}>
          {formatCurrency(portfolio.totalGain)} ({formatPercent(dayGainPercent)})
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <div className="flex items-center gap-2 text-gray-500 text-sm mb-1">
          <Activity className="w-4 h-4" />
          Buying Power
        </div>
        <div className="text-2xl font-bold text-gray-900">
          {formatCurrency(portfolio.buyingPower)}
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <div className="flex items-center gap-2 text-gray-500 text-sm mb-1">
          <BarChart3 className="w-4 h-4" />
          Positions
        </div>
        <div className="text-2xl font-bold text-gray-900">
          {portfolio.positions.length}
        </div>
      </div>
    </div>
  );
}

function PortfolioAllocation({ portfolio }: { portfolio: Portfolio }) {
  const pieData = portfolio.positions.map((pos, index) => ({
    name: pos.symbol,
    value: pos.currentValue,
    color: COLORS[index % COLORS.length],
  }));

  // Add cash/buying power if significant
  if (portfolio.buyingPower > 0) {
    pieData.push({
      name: 'Cash',
      value: portfolio.buyingPower,
      color: '#9CA3AF',
    });
  }

  const CustomTooltip = ({ active, payload }: { active?: boolean; payload?: Array<{ name: string; value: number }> }) => {
    if (!active || !payload || !payload.length) return null;
    const data = payload[0];
    const total = pieData.reduce((sum, item) => sum + item.value, 0);
    const percent = ((data.value / total) * 100).toFixed(1);
    return (
      <div className="bg-white border border-gray-200 rounded-lg shadow-lg p-3">
        <p className="font-medium">{data.name}</p>
        <p className="text-sm text-gray-600">{formatCurrency(data.value)}</p>
        <p className="text-sm text-gray-500">{percent}%</p>
      </div>
    );
  };

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4">
      <h3 className="text-lg font-semibold text-gray-900 mb-4">Portfolio Allocation</h3>
      <ResponsiveContainer width="100%" height={300}>
        <PieChart>
          <Pie
            data={pieData}
            cx="50%"
            cy="50%"
            innerRadius={60}
            outerRadius={100}
            paddingAngle={2}
            dataKey="value"
          >
            {pieData.map((entry, index) => (
              <Cell key={`cell-${index}`} fill={entry.color} />
            ))}
          </Pie>
          <Tooltip content={<CustomTooltip />} />
          <Legend />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}

function PositionsTable({ portfolio }: { portfolio: Portfolio }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-200">
        <h3 className="text-lg font-semibold text-gray-900">Holdings</h3>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Symbol</th>
              <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Shares</th>
              <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Price</th>
              <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Avg Cost</th>
              <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Value</th>
              <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Total Gain</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {portfolio.positions.map((position, index) => (
              <tr key={position.symbol} className={index % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                <td className="px-4 py-3">
                  <div className="font-medium text-gray-900">{position.symbol}</div>
                  <div className="text-sm text-gray-500 truncate max-w-[150px]">{position.name}</div>
                </td>
                <td className="px-4 py-3 text-right text-gray-900">{position.quantity.toFixed(4)}</td>
                <td className="px-4 py-3 text-right text-gray-900">{formatCurrency(position.currentPrice)}</td>
                <td className="px-4 py-3 text-right text-gray-500">{formatCurrency(position.averageCost)}</td>
                <td className="px-4 py-3 text-right font-medium text-gray-900">{formatCurrency(position.currentValue)}</td>
                <td className="px-4 py-3 text-right">
                  <div className={`font-medium ${getGainColor(position.gain)}`}>
                    {formatCurrency(position.gain)}
                  </div>
                  <div className={`text-sm ${getGainColor(position.gainPercent)}`}>
                    {formatPercent(position.gainPercent)}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function BotActionsLog({ actions }: { actions: BotAction[] }) {
  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'completed':
      case 'submitted':
        return <CheckCircle className="w-4 h-4 text-green-500" />;
      case 'failed':
      case 'error':
        return <XCircle className="w-4 h-4 text-red-500" />;
      case 'simulated':
        return <Bot className="w-4 h-4 text-blue-500" />;
      default:
        return <Activity className="w-4 h-4 text-gray-500" />;
    }
  };

  const getTypeColor = (type: string) => {
    switch (type) {
      case 'BUY_ORDER':
        return 'bg-green-100 text-green-800';
      case 'SELL_ORDER':
        return 'bg-red-100 text-red-800';
      case 'ANALYSIS':
        return 'bg-blue-100 text-blue-800';
      case 'ERROR':
        return 'bg-red-100 text-red-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  return (
    <div className="bg-white rounded-xl border border-gray-200">
      <div className="px-4 py-3 border-b border-gray-200 flex items-center gap-2">
        <Bot className="w-5 h-5 text-indigo-500" />
        <h3 className="text-lg font-semibold text-gray-900">Bot Activity</h3>
      </div>
      <div className="max-h-[400px] overflow-y-auto">
        {actions.length === 0 ? (
          <div className="p-8 text-center text-gray-500">
            <Bot className="w-12 h-12 mx-auto mb-3 text-gray-300" />
            <p>No bot actions yet</p>
            <p className="text-sm">Run an analysis to get started</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {actions.map((action) => (
              <div key={action.id} className="px-4 py-3 hover:bg-gray-50">
                <div className="flex items-start gap-3">
                  {getStatusIcon(action.status)}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`px-2 py-0.5 text-xs font-medium rounded ${getTypeColor(action.type)}`}>
                        {action.type.replace('_', ' ')}
                      </span>
                      {action.symbol && (
                        <span className="font-medium text-gray-900">{action.symbol}</span>
                      )}
                      {action.dryRun && (
                        <span className="px-2 py-0.5 text-xs bg-yellow-100 text-yellow-800 rounded">
                          DRY RUN
                        </span>
                      )}
                    </div>
                    {action.quantity && action.price && (
                      <p className="text-sm text-gray-600 mt-1">
                        {action.quantity} shares @ {formatCurrency(action.price)} = {formatCurrency(action.total || 0)}
                      </p>
                    )}
                    {action.message && (
                      <p className="text-sm text-gray-600 mt-1">{action.message}</p>
                    )}
                    {action.details && (
                      <p className="text-sm text-gray-600 mt-1">{action.details}</p>
                    )}
                    <p className="text-xs text-gray-400 mt-1">
                      {new Date(action.timestamp).toLocaleString()}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function AnalysisSuggestions({ analysis }: { analysis: BotAnalysis | null }) {
  if (!analysis) return null;

  return (
    <div className="bg-white rounded-xl border border-gray-200">
      <div className="px-4 py-3 border-b border-gray-200 flex items-center gap-2">
        <AlertTriangle className="w-5 h-5 text-yellow-500" />
        <h3 className="text-lg font-semibold text-gray-900">Bot Suggestions</h3>
      </div>
      {analysis.suggestions.length === 0 ? (
        <div className="p-6 text-center text-gray-500">
          <CheckCircle className="w-12 h-12 mx-auto mb-3 text-green-300" />
          <p>No action needed</p>
          <p className="text-sm">Your portfolio looks balanced</p>
        </div>
      ) : (
        <div className="divide-y divide-gray-100">
          {analysis.suggestions.map((suggestion, index) => (
            <div key={index} className="px-4 py-3">
              <div className="flex items-center gap-2 mb-1">
                <span className={`px-2 py-0.5 text-xs font-medium rounded ${
                  suggestion.type === 'TAKE_PROFIT' ? 'bg-green-100 text-green-800' :
                  suggestion.type === 'STOP_LOSS' ? 'bg-red-100 text-red-800' :
                  'bg-gray-100 text-gray-800'
                }`}>
                  {suggestion.type.replace('_', ' ')}
                </span>
                <span className="font-medium text-gray-900">{suggestion.symbol}</span>
                <span className={`ml-auto px-2 py-0.5 text-xs rounded ${
                  suggestion.priority === 'high' ? 'bg-red-100 text-red-800' :
                  suggestion.priority === 'medium' ? 'bg-yellow-100 text-yellow-800' :
                  'bg-gray-100 text-gray-800'
                }`}>
                  {suggestion.priority}
                </span>
              </div>
              <p className="text-sm text-gray-600">{suggestion.reason}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function TradePage() {
  const [portfolio, setPortfolio] = useState<Portfolio | null>(null);
  const [botActions, setBotActions] = useState<BotAction[]>([]);
  const [analysis, setAnalysis] = useState<BotAnalysis | null>(null);
  const [authStatus, setAuthStatus] = useState<AuthStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);

  const fetchAuthStatus = useCallback(async () => {
    try {
      const status = await getAuthStatus();
      setAuthStatus(status);
      return status.authenticated;
    } catch (err) {
      console.error('Failed to fetch auth status:', err);
      return false;
    }
  }, []);

  const fetchData = async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);

    try {
      // Check auth first
      const isAuthenticated = await fetchAuthStatus();

      if (!isAuthenticated) {
        setLoading(false);
        setRefreshing(false);
        return;
      }

      const [portfolioData, actionsData] = await Promise.all([
        getPortfolio(),
        getBotActions(50),
      ]);
      setPortfolio(portfolioData);
      setBotActions(actionsData.actions);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to fetch data';
      // Don't show auth errors as errors, just show auth panel
      if (!errorMsg.includes('Not authenticated') && !errorMsg.includes('expired')) {
        setError(errorMsg);
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const runAnalysis = async () => {
    setAnalyzing(true);
    try {
      const analysisData = await analyzePortfolio();
      setAnalysis(analysisData);
      // Refresh actions after analysis
      const actionsData = await getBotActions(50);
      setBotActions(actionsData.actions);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Analysis failed');
    } finally {
      setAnalyzing(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  if (loading) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="animate-pulse">
          <div className="h-8 bg-gray-200 rounded w-64 mb-4"></div>
          <div className="h-4 bg-gray-200 rounded w-96 mb-8"></div>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-24 bg-gray-200 rounded-xl"></div>
            ))}
          </div>
          <div className="h-96 bg-gray-200 rounded-xl"></div>
        </div>
      </div>
    );
  }

  // Show auth panel if not connected
  if (!authStatus?.authenticated && !loading) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Trade</h1>
            <p className="text-gray-500 mt-1">
              Connect to Robinhood to view your portfolio
            </p>
          </div>
        </div>

        <AuthPanel authStatus={authStatus} onAuthChange={fetchData} />

        <div className="text-center py-12 bg-gray-50 rounded-xl border border-gray-200">
          <Shield className="w-16 h-16 mx-auto mb-4 text-gray-300" />
          <p className="text-lg font-medium text-gray-600 mb-2">Connect to Robinhood</p>
          <p className="text-gray-500 max-w-md mx-auto">
            Click the Connect button above to link your Robinhood account.
            You'll need to approve the connection in the Robinhood app.
          </p>
        </div>
      </div>
    );
  }

  if (error && !portfolio) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <AuthPanel authStatus={authStatus} onAuthChange={fetchData} />
        <div className="text-center py-12">
          <XCircle className="w-16 h-16 mx-auto mb-4 text-red-300" />
          <p className="text-lg font-medium text-red-600 mb-2">{error}</p>
          <button
            onClick={() => fetchData()}
            className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600"
          >
            Try Again
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Trade</h1>
          <p className="text-gray-500 mt-1">
            Robinhood portfolio and trading bot activity
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={runAnalysis}
            disabled={analyzing}
            className="flex items-center gap-2 px-4 py-2 bg-indigo-500 text-white rounded-lg hover:bg-indigo-600 disabled:opacity-50"
          >
            <Bot className={`w-4 h-4 ${analyzing ? 'animate-pulse' : ''}`} />
            {analyzing ? 'Analyzing...' : 'Run Analysis'}
          </button>
          <button
            onClick={() => fetchData(true)}
            disabled={refreshing}
            className="flex items-center gap-2 px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </div>

      <AuthPanel authStatus={authStatus} onAuthChange={fetchData} />

      {error && (
        <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700">
          {error}
        </div>
      )}

      {portfolio && (
        <>
          <PortfolioSummary portfolio={portfolio} />

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
            <PortfolioAllocation portfolio={portfolio} />
            <AnalysisSuggestions analysis={analysis} />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2">
              <PositionsTable portfolio={portfolio} />
            </div>
            <div>
              <BotActionsLog actions={botActions} />
            </div>
          </div>
        </>
      )}
    </div>
  );
}
