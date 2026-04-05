# Architecture Diagram

## System Overview

```
+-----------------------------------------------------------------------------------+
|                              ALLOCATION MANAGER                                   |
|                     Systematic Asset Trading Service                               |
+-----------------------------------------------------------------------------------+

+-----------------------------------------------------------------------------------+
|                                FRONTEND                                           |
|                        React 18 + TypeScript + Vite                               |
|                                                                                   |
|  +------------------+  +------------------+  +------------------+                 |
|  |   LandingPage    |  |  DashboardPage   |  |   ComparePage    |                 |
|  |  Asset Selection  |  |  Price Tracking  |  | Portfolio Compare|                 |
|  +------------------+  |  Market Stats    |  | Returns Analysis |                 |
|                         |  Charts & News   |  | Fee Modeling     |                 |
|  +------------------+  +------------------+  +------------------+                 |
|  |    TradePage     |  |  StrategiesPage  |  |  ConfigurePage   |                 |
|  | RH Portfolio     |  | Market Depth     |  | Robinhood OAuth  |                 |
|  | Bot Actions      |  | Volatility Puts  |  | Plaid Link       |                 |
|  | PnL Tracking     |  | Weekend Momentum |  | Auth Status      |                 |
|  | Order Book       |  | News Straddle    |  |                  |                 |
|  +------------------+  +------------------+  +------------------+                 |
|                                                                                   |
|  +---------------------------+  +-------------------+  +--------------------+     |
|  |     Service Layer         |  |     Contexts      |  |      Utils         |     |
|  | robinhoodService.ts       |  | ThemeContext       |  | formatters.ts      |     |
|  | plaidService.ts           |  | (Dark/Light Mode)  |  | portfolioCalcs.ts  |     |
|  | twelveDataService.ts      |  | (Font Modes)      |  |                    |     |
|  | bitcoinService.ts         |  +-------------------+  +--------------------+     |
|  | newsService.ts            |                                                    |
|  | marketIndicatorService.ts |  Styling: Tailwind CSS + Radix UI                  |
|  | blobDataService.ts        |  Routing: React Router v7                          |
|  | weekendMomentumService.ts |  Charts:  Recharts                                 |
|  | perplexityNewsService.ts  |                                                    |
|  +---------------------------+                                                    |
+-----------------------------------------------------------------------------------+
                |                                    |
                | HTTP/fetch                         | Direct API calls
                | /.netlify/functions/*              | (CoinGecko, Twelve Data)
                v                                    v
+-----------------------------------------------------------------------------------+
|                            BACKEND (Netlify Functions)                             |
|                             Node.js Serverless                                    |
|                                                                                   |
|  +--- Broker Integration ---+  +--- Market Data -------+  +--- News ----------+  |
|  | robinhood-auth.cjs       |  | coingecko-market.cjs   |  | coindesk-news.cjs |  |
|  | robinhood-portfolio.cjs  |  | deribit-dvol.cjs       |  | polygon-news.cjs  |  |
|  | robinhood-bot.cjs        |  | vend-blobs.cjs         |  | finnhub-news.cjs  |  |
|  | plaid-link.cjs           |  | order-book-snapshot.cjs|  | perplexity-news   |  |
|  +---------------------------+  +------------------------+  | news-cache.mts    |  |
|                                                             | scheduled-fetch   |  |
|  +--- Shared Libs -----------+  +--- Infrastructure ---+   +-------------------+  |
|  | lib/tokenStore.cjs        |  | redis-holdings.cjs   |                          |
|  | (Dual-mode token store)   |  | alert-slack.cjs      |                          |
|  +---------------------------+  +----------------------+                          |
+-----------------------------------------------------------------------------------+
                |                        |                       |
                v                        v                       v
+-----------------------------------------------------------------------------------+
|                           EXTERNAL SERVICES                                       |
|                                                                                   |
|  +--- Brokers --------+  +--- Market Data -------+  +--- Financial Data ---+     |
|  | Robinhood API       |  | CoinGecko (Free)      |  | CoinDesk            |     |
|  |  - OAuth2 Auth      |  |  - BTC Market Data     |  | Polygon.io          |     |
|  |  - Portfolio        |  | Twelve Data            |  | Finnhub             |     |
|  |  - Orders/Trading   |  |  - OHLC Time Series    |  | Perplexity AI       |     |
|  | Plaid               |  |  - Technical Indicators|  |                     |     |
|  |  - Bank Linking     |  | Deribit                |  |                     |     |
|  |  - Holdings         |  |  - Derivatives Vol     |  |                     |     |
|  +---------------------+  +------------------------+  +---------------------+     |
+-----------------------------------------------------------------------------------+

+-----------------------------------------------------------------------------------+
|                           DATA PERSISTENCE                                        |
|                                                                                   |
|  +--- Netlify Blobs ---------------+  +--- Redis ---+  +--- Local Dev --------+  |
|  | robinhood-auth (OAuth tokens)   |  | Holdings    |  | ~/.tokens/           |  |
|  | plaid-tokens (access tokens)    |  | cache       |  | robinhood-blobs.json |  |
|  | news-articles (cached news)     |  |             |  | plaid-blobs.json     |  |
|  | options-chain (from alloc-eng)  |  |             |  |                      |  |
|  | market-quotes (from alloc-eng)  |  |             |  |                      |  |
|  +---------------------------------+  +-------------+  +----------------------+  |
+-----------------------------------------------------------------------------------+

+-----------------------------------------------------------------------------------+
|                       CI/CD & DEPLOYMENT                                          |
|                                                                                   |
|  GitHub Actions (.github/workflows/deploy-netlify.yml)                            |
|                                                                                   |
|  Push to main/master ──> Build (tsc + vite) ──> Deploy to Netlify                 |
|                                                                                   |
|  +--- Environments -------------------------------------------------------+      |
|  | Gamma (Staging): https://route-manager-gamma.netlify.app/               |      |
|  | Prod:            https://route-manager-prod.netlify.app/                |      |
|  | Custom Domain:   https://5thstreetcapital.org/                          |      |
|  +------------------------------------------------------------------------+      |
|                                                                                   |
|  Secrets: NETLIFY_AUTH_TOKEN, NETLIFY_SITE_ID_GAMMA, NETLIFY_SITE_ID_PROD         |
+-----------------------------------------------------------------------------------+
```

## Data Flow

```
User Interaction
      |
      v
React Pages & Components
      |
      v
Service Layer (TypeScript)
      |
      +----> Direct API calls (CoinGecko, Twelve Data)
      |
      +----> /.netlify/functions/* (HTTP fetch)
                    |
                    v
             Netlify Functions (Node.js)
                    |
                    +----> External APIs (Robinhood, Plaid, Polygon, etc.)
                    |
                    +----> Netlify Blobs (token/data persistence)
                    |
                    +----> Redis (holdings cache)
                    |
                    v
             Response flows back up through the stack
```

## Authentication Flows

```
Robinhood OAuth2:
  ConfigurePage -> robinhoodService -> robinhood-auth.cjs -> Robinhood API
      |                                      |
      |                                      +--> Tokens stored in Netlify Blobs
      |                                      +--> MFA/Device verification supported
      v
  TradePage -> robinhoodService -> robinhood-portfolio.cjs -> Robinhood API
                                         |
                                         +--> Token refresh via Netlify Blobs

Plaid Link:
  ConfigurePage -> Plaid Link Modal -> plaidService -> plaid-link.cjs -> Plaid API
      |                                                      |
      |                                                      +--> Access tokens in Blobs
      v
  Holdings data retrieved via plaid-link.cjs GET
```

## Key Architectural Patterns

| Pattern | Description |
|---------|-------------|
| **Service Layer Abstraction** | All API calls go through TypeScript service modules |
| **Serverless Proxy** | Netlify Functions proxy external APIs to protect credentials |
| **Dual-Mode Storage** | Netlify Blobs in production, local filesystem in development |
| **Context-Based State** | React Context for theme/font preferences |
| **Component Composition** | Pages built from small, reusable components |
| **CORS-Enabled Functions** | All serverless functions support cross-origin requests |
