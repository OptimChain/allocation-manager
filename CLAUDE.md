# Claude Code Instructions

## Git Commits

When creating git commits:
- Do NOT include the "Generated with Claude Code" tag
- Do NOT include the robot emoji or Claude Code link
- Do NOT include the Co-Authored-By line for Claude
- Keep commit messages clean and professional

---

## Overview

Apollo Flight Trader (Route Manager) is a flight price monitoring and booking optimization tool. It enables last-minute travel by prebooking commonly taken flights at flex/main levels, allowing for spontaneous trips and upgrades while reducing airport planning overhead.

### Key Features
- Low latency flight price monitoring with historical and volatility analysis
- Route management for tracking common flight routes and pricing
- Direct integration with Amadeus Flight API
- Planned: Booking, rescheduling, and buying agent

## Tech Stack

| Layer | Technology |
|-------|------------|
| Frontend | React 18, TypeScript, Vite |
| Styling | Tailwind CSS, Radix UI |
| Charts | Recharts, Chart.js |
| Backend | Netlify Functions (serverless) |
| API | Amadeus Flight API |
| Deployment | Netlify, GitHub Actions |

## Development Commands

```bash
# Install dependencies
npm install

# Start development server (frontend + Netlify functions)
npm run dev:clean

# Build for production
npm run build

# Preview production build
npm run preview

# Run tests
npm test
npm run test:watch

# Linting
npm run lint

# Deploy to Netlify
npm run deploy

```

## Workspace Structure

**IMPORTANT**: Only look inside the directories defined below. Do not explore or modify files outside this structure.

```
monterrey/
├── src/
│   ├── components/       # React components
│   │   ├── ui/           # Reusable UI primitives (Radix-based)
│   │   ├── FlightSearch.tsx
│   │   ├── RoutesDashboard.tsx
│   │   ├── PriceChart.tsx
│   │   └── ...
│   ├── pages/            # Page components
│   ├── services/         # API service layers
│   ├── types/            # TypeScript type definitions
│   ├── utils/            # Utility functions
│   ├── config/           # Configuration files
│   └── lib/              # Shared libraries
├── netlify/
│   └── functions/        # Serverless API endpoints
│       ├── search-flights.js
│       ├── flight-prices.js
│       ├── popular-routes.js
│       ├── health.js
│       └── ...
└── common/               # Shared code between frontend and functions
```

## Architecture Patterns

### Frontend
- **Component Structure**: Functional components with hooks
- **State Management**: React useState/useEffect (no Redux)

### Backend (Netlify Functions)
- **Pattern**: Serverless functions with CORS middleware
- **API Integration**: Amadeus SDK for flight data

### Deployment
- **Environments**: Gamma (staging) and Prod (protected)
- **CI/CD**: GitHub Actions with manual prod deployment gate
- **Secrets**: `NETLIFY_AUTH_TOKEN`, `NETLIFY_SITE_ID_GAMMA`, `NETLIFY_SITE_ID_PROD`

## Authentication

Currently no user authentication implemented. Amadeus API credentials are stored as environment variables in Netlify:
- `AMADEUS_API_KEY`
- `AMADEUS_API_SECRET`
- `AMADEUS_HOSTNAME`

## Backlog

Project backlog: https://github.com/users/IamJasonBian/projects/1

## Environments

| Environment | URL |
|-------------|-----|
| Gamma | https://route-manager-gamma.netlify.app/ |
| Prod | https://route-manager-prod.netlify.app/ |

---

## 5th Street Capital — Allocation Manager

The active trading dashboard for 5th Street Capital, backed by Robinhood data via Netlify Blobs.

### Key Info
- **Repo**: `OptimChain/allocation-manager`
- **Site**: `5thstreetcapital.netlify.app` (Netlify site ID: `3d014fc3-e919-4b4d-b374-e8606dee50df`)
- **Blob store**: `state-logs` — keyed by ISO timestamps, written by `trading_system/state/blob_logger.py`
- **Main Netlify function**: `netlify/functions/enriched-snapshot.cjs`

### Common Commands

```bash
# TypeScript check (must run from /Users/jasonzb/allocation-manager)
node_modules/.bin/tsc --noEmit

# Switch GitHub account to push to OptimChain org
gh auth switch --user OptimChain
git push origin HEAD

# Switch back to personal account
gh auth switch --user IamJasonBian

# Watch a CI run
gh run watch <run-id> --repo OptimChain/allocation-manager

# List recent CI runs
gh run list --repo OptimChain/allocation-manager --limit 5 --json databaseId,status,conclusion,headBranch

# Check PR
gh pr view 68 --repo OptimChain/allocation-manager

# Test enriched-snapshot endpoint (use deploy preview hash URL, not main domain)
curl -s "https://<hash>--5thstreetcapital.netlify.app/.netlify/functions/enriched-snapshot" | python3 -m json.tool | head -50

# Manually upload blob snapshot (run from /Users/jasonzb/Desktop/apollo/allocation-engine)
python3 main.py  # or the relevant upload script
```

### Data Flow

```
SafeCashBot (RH API) → blob_logger.py → Netlify Blob store (state-logs)
→ enriched-snapshot.cjs (Netlify function) → TradePage.tsx
```

### RH API Gotchas
- `get_all_stock_orders()`: `side` is lowercase, `symbol` is null (instrument URL only), open orders use `id`/`type`/`price` (not `order_id`/`order_type`/`limit_price`)
- `chain_symbol` for option orders is at the **order level**, not inside `legs[0]`
- `load_phoenix_account()` fails with SSL error — use `load_account_profile()` instead
- Timestamps from blob are naive UTC (no `Z`) — append `Z` before `new Date()` to avoid local-time misparse

### Field Name Variations (blob vs raw RH API)
| Concept | Engine blob | Raw RH API |
|---------|------------|-----------|
| Order ID | `order_id` | `id` |
| Order type | `order_type` | `type` |
| Limit price | `limit_price` | `price` |
| Side | uppercase `BUY`/`SELL` | lowercase `buy`/`sell` |
| Symbol | populated | `null` (resolve from instrument URL) |
| Option strike | `strike` | `strike_price` |
| Option expiry | `expiration` | `expiration_date` |

### Netlify Deploy Notes
- Push to `IamJasonBian/enriched-snapshot-rework` triggers GitHub Actions deploy to Netlify preview
- Production domain (`5thstreetcapital.netlify.app`) may serve cached HTML for function paths — use deploy preview hash URL for immediate testing
- `NETLIFY_AUTH_TOKEN` env var must be set in Netlify site settings for blob access
