## Systematic Asset Trading Service

**Version - 0.1.0**

[![Netlify Status](https://api.netlify.com/api/v1/badges/3d014fc3-e919-4b4d-b374-e8606dee50df/deploy-status)](https://app.netlify.com/projects/5thstreetcapital/deploys)
[![Deploy to Netlify](https://github.com/OptimChain/allocation-manager/actions/workflows/deploy-netlify.yml/badge.svg)](https://github.com/OptimChain/allocation-manager/actions/workflows/deploy-netlify.yml)

![5thStreetCapital](docs/captures/5thstreet.gif)

A real-time asset tracking, market analysis, and trading engine system with hosted metrics, local engine deployments, and broker integration. 

## Features

The trading system is packaged seperately in [allocation-engine](https://github.com/IamJasonBian/allocation-engine/tree/main/trading_system) with the training system packaged in [allocation-gym](https://github.com/IamJasonBian/allocation-gym).  The trading system can be hosted using local and managed compute environments to make calls to the allocation-manager service for broker integration. 

Deployed keys and auth will be managed locally. 

Site: https://5thstreetcapital.org/

## Example Data Sources (Bring Your Own Datasource for Featurization)

* [CoinGecko API](https://www.coingecko.com/en/api/documentation)
* Twelve Data
* Polygon.io
* TradingView Ecosystem

## Supported Assets

* BTC
* BTC/USD

## Supported Brokers

* Alpaca
* Robinhood
* Binance.us



## License

MIT
