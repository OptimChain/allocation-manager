import { useState } from 'react';
import { ChevronDown, ChevronUp, Droplets, Globe, Flame, ArrowUpRight, ArrowDownRight, Minus } from 'lucide-react';

interface AssetImpact {
  asset: string;
  move: number; // percentage move
  direction: 'up' | 'down' | 'flat';
}

interface CorrelationShift {
  pair: string;
  before: number;
  after: number;
  window: string;
}

interface StraddleEvent {
  id: string;
  category: 'oil' | 'geopolitical' | 'macro';
  title: string;
  date: string;
  description: string;
  impacts: AssetImpact[];
  correlationShifts: CorrelationShift[];
  confoundingNote: string;
}

const STRADDLE_EVENTS: StraddleEvent[] = [
  {
    id: 'opec-cut-2024',
    category: 'oil',
    title: 'OPEC+ Surprise 1M bbl/day Cut',
    date: '2024-06-02',
    description: 'Unannounced production cut drove WTI from $72 to $82 in 5 sessions. Small-cap energy consumers absorbed margin compression while BTC sold off on USD strength.',
    impacts: [
      { asset: 'BTC', move: -6.2, direction: 'down' },
      { asset: 'IWN', move: -4.8, direction: 'down' },
      { asset: 'DXY', move: 1.9, direction: 'up' },
      { asset: 'VIX', move: 18.5, direction: 'up' },
      { asset: '2Y Yield', move: 0.12, direction: 'up' },
      { asset: '10Y Yield', move: 0.08, direction: 'up' },
      { asset: 'USO', move: 13.8, direction: 'up' },
    ],
    correlationShifts: [
      { pair: 'BTC-IWN', before: 0.31, after: 0.74, window: '5-day event' },
      { pair: 'BTC-IWN', before: 0.28, after: 0.52, window: '30-day trailing' },
      { pair: 'BTC-DXY', before: -0.41, after: -0.68, window: '5-day event' },
    ],
    confoundingNote: 'Oil supply shocks force BTC and IWN into spurious lockstep: DXY strengthens (partially captured by controls) but IWN small-cap input cost inflation is an uncontrolled channel. The BTC-IWN partial correlation jumped from 0.31 → 0.74 during the 5-day window — most of this co-movement is oil-driven, not fundamental.',
  },
  {
    id: 'hormuz-drone-2025',
    category: 'geopolitical',
    title: 'Strait of Hormuz Drone Incident',
    date: '2025-01-14',
    description: 'Iranian-linked drone strike on commercial tanker near Hormuz. Brief shipping halt spiked crude +8% intraday, triggered broad risk-off.',
    impacts: [
      { asset: 'BTC', move: -8.1, direction: 'down' },
      { asset: 'IWN', move: -5.3, direction: 'down' },
      { asset: 'DXY', move: 1.4, direction: 'up' },
      { asset: 'VIX', move: 32.0, direction: 'up' },
      { asset: '2Y Yield', move: -0.09, direction: 'down' },
      { asset: '10Y Yield', move: -0.14, direction: 'down' },
      { asset: 'USO', move: 8.2, direction: 'up' },
    ],
    correlationShifts: [
      { pair: 'BTC-IWN', before: 0.22, after: 0.81, window: '3-day event' },
      { pair: 'BTC-IWN', before: 0.25, after: 0.58, window: '30-day trailing' },
      { pair: 'IWN-VIX', before: -0.55, after: -0.79, window: '3-day event' },
    ],
    confoundingNote: 'Dual-channel confound: oil supply fear (IWN cost inflation) + flight-to-safety (BTC risk-off). VIX spike is partially controlled but the supply-shock mechanism isn\'t — yields actually fell (safety bid) while equities and BTC dropped together. BTC-IWN partial corr surged to 0.81.',
  },
  {
    id: 'russia-shadow-fleet',
    category: 'geopolitical',
    title: 'EU Shadow Fleet Sanctions Package',
    date: '2025-03-10',
    description: 'EU sanctioned 47 Russian shadow fleet tankers, removing ~800K bbl/day from grey market. Brent jumped $6 over 2 weeks as supply tightened.',
    impacts: [
      { asset: 'BTC', move: -3.9, direction: 'down' },
      { asset: 'IWN', move: -3.1, direction: 'down' },
      { asset: 'DXY', move: 0.8, direction: 'up' },
      { asset: 'VIX', move: 11.2, direction: 'up' },
      { asset: '2Y Yield', move: 0.06, direction: 'up' },
      { asset: '10Y Yield', move: 0.04, direction: 'up' },
      { asset: 'USO', move: 7.1, direction: 'up' },
    ],
    correlationShifts: [
      { pair: 'BTC-IWN', before: 0.18, after: 0.59, window: '10-day event' },
      { pair: 'BTC-IWN', before: 0.21, after: 0.43, window: '30-day trailing' },
      { pair: 'BTC-USO', before: -0.12, after: -0.51, window: '10-day event' },
    ],
    confoundingNote: 'Sanctions create a slow-burn confound. The gradual oil repricing compresses IWN margins over weeks while BTC drifts lower on macro uncertainty. The correlation shift is smaller per-day but persistent — 30-day BTC-IWN partial corr moved from 0.21 → 0.43, suggesting sustained confounding.',
  },
  {
    id: 'spr-release-2025',
    category: 'oil',
    title: 'US SPR Emergency Release (20M bbl)',
    date: '2025-05-18',
    description: 'Biden admin released 20M barrels to counter post-sanctions price spike. Crude dropped $5 in 3 sessions, relieving small-cap cost pressure.',
    impacts: [
      { asset: 'BTC', move: 4.2, direction: 'up' },
      { asset: 'IWN', move: 3.8, direction: 'up' },
      { asset: 'DXY', move: -0.6, direction: 'down' },
      { asset: 'VIX', move: -14.3, direction: 'down' },
      { asset: '2Y Yield', move: -0.03, direction: 'down' },
      { asset: '10Y Yield', move: -0.02, direction: 'down' },
      { asset: 'USO', move: -5.9, direction: 'down' },
    ],
    correlationShifts: [
      { pair: 'BTC-IWN', before: 0.35, after: 0.71, window: '5-day event' },
      { pair: 'BTC-IWN', before: 0.30, after: 0.48, window: '30-day trailing' },
      { pair: 'IWN-USO', before: -0.22, after: -0.63, window: '5-day event' },
    ],
    confoundingNote: 'Mirror image of supply shocks — SPR releases create risk-on correlation spikes. BTC and IWN rally together as oil relief weakens DXY (captured) and lowers input costs (uncaptured). The 0.35 → 0.71 BTC-IWN shift shows the partial correlation model fails symmetrically in both directions.',
  },
  {
    id: 'taiwan-exercises-2025',
    category: 'geopolitical',
    title: 'PLA Live-Fire Exercises Around Taiwan',
    date: '2025-08-15',
    description: 'China conducted 5-day naval exercises with simulated blockade. TSMC supply chain fears hit semis and small-cap manufacturers; crypto sold off on China crackdown risk.',
    impacts: [
      { asset: 'BTC', move: -11.4, direction: 'down' },
      { asset: 'IWN', move: -7.2, direction: 'down' },
      { asset: 'DXY', move: 2.3, direction: 'up' },
      { asset: 'VIX', move: 45.0, direction: 'up' },
      { asset: '2Y Yield', move: -0.18, direction: 'down' },
      { asset: '10Y Yield', move: -0.22, direction: 'down' },
      { asset: 'USO', move: 4.1, direction: 'up' },
    ],
    correlationShifts: [
      { pair: 'BTC-IWN', before: 0.19, after: 0.88, window: '5-day event' },
      { pair: 'BTC-IWN', before: 0.23, after: 0.61, window: '30-day trailing' },
      { pair: 'BTC-VIX', before: -0.38, after: -0.82, window: '5-day event' },
    ],
    confoundingNote: 'Compound confound with highest correlation spike observed. VIX control captures some variance but supply-chain disruption to IWN small-caps and China-specific BTC regulatory fear are independent channels both pushing assets down. BTC-IWN partial corr hit 0.88 — almost pure confounding.',
  },
  {
    id: 'red-sea-escalation',
    category: 'geopolitical',
    title: 'Houthi Missile Strike on LNG Carrier',
    date: '2025-11-03',
    description: 'First successful strike on LNG tanker in Red Sea. Shipping costs spiked 40%, European energy prices surged. Small-cap importers hit on freight costs.',
    impacts: [
      { asset: 'BTC', move: -5.6, direction: 'down' },
      { asset: 'IWN', move: -4.9, direction: 'down' },
      { asset: 'DXY', move: 1.1, direction: 'up' },
      { asset: 'VIX', move: 22.7, direction: 'up' },
      { asset: '2Y Yield', move: 0.07, direction: 'up' },
      { asset: '10Y Yield', move: 0.05, direction: 'up' },
      { asset: 'USO', move: 6.3, direction: 'up' },
    ],
    correlationShifts: [
      { pair: 'BTC-IWN', before: 0.26, after: 0.69, window: '5-day event' },
      { pair: 'BTC-IWN', before: 0.24, after: 0.47, window: '30-day trailing' },
      { pair: 'IWN-USO', before: -0.18, after: -0.58, window: '5-day event' },
    ],
    confoundingNote: 'Shipping-cost confound: IWN small-caps face higher import costs through an uncontrolled channel while BTC sells off on broad risk-off. Yield controls capture inflation expectations partially but miss the supply-side freight-to-earnings transmission.',
  },
  {
    id: 'tariff-energy-2026',
    category: 'macro',
    title: 'US 25% Tariff on Energy Imports',
    date: '2026-02-01',
    description: 'New tariffs on Canadian and Mexican crude imports repriced domestic energy spreads. WTI-Brent spread widened $4. Small-cap refiners and consumers whipsawed.',
    impacts: [
      { asset: 'BTC', move: -4.5, direction: 'down' },
      { asset: 'IWN', move: -6.1, direction: 'down' },
      { asset: 'DXY', move: 1.6, direction: 'up' },
      { asset: 'VIX', move: 16.8, direction: 'up' },
      { asset: '2Y Yield', move: 0.14, direction: 'up' },
      { asset: '10Y Yield', move: 0.09, direction: 'up' },
      { asset: 'USO', move: 5.4, direction: 'up' },
    ],
    correlationShifts: [
      { pair: 'BTC-IWN', before: 0.29, after: 0.64, window: '10-day event' },
      { pair: 'BTC-IWN', before: 0.27, after: 0.51, window: '30-day trailing' },
      { pair: 'IWN-DXY', before: -0.33, after: -0.62, window: '10-day event' },
    ],
    confoundingNote: 'Trade policy is entirely uncontrolled in the partial correlation model. Tariffs strengthen DXY (partially absorbed) but create sector-specific IWN pain via domestic energy repricing and BTC uncertainty through regulatory overhang. IWN dropped harder than BTC here (-6.1% vs -4.5%), unusual for these events.',
  },
];

const CATEGORY_CONFIG = {
  oil: { icon: Droplets, label: 'Oil/Energy', color: 'text-amber-600 dark:text-amber-400', bg: 'bg-amber-50 dark:bg-amber-950/30', border: 'border-amber-200 dark:border-amber-800' },
  geopolitical: { icon: Globe, label: 'Geopolitical', color: 'text-red-600 dark:text-red-400', bg: 'bg-red-50 dark:bg-red-950/30', border: 'border-red-200 dark:border-red-800' },
  macro: { icon: Flame, label: 'Macro/Policy', color: 'text-blue-600 dark:text-blue-400', bg: 'bg-blue-50 dark:bg-blue-950/30', border: 'border-blue-200 dark:border-blue-800' },
};

function MoveIcon({ direction }: { direction: 'up' | 'down' | 'flat' }) {
  if (direction === 'up') return <ArrowUpRight className="w-3 h-3 text-green-500" />;
  if (direction === 'down') return <ArrowDownRight className="w-3 h-3 text-red-500" />;
  return <Minus className="w-3 h-3 text-gray-400" />;
}

function formatMove(move: number, asset: string): string {
  const isYield = asset.includes('Yield');
  if (isYield) {
    const sign = move >= 0 ? '+' : '';
    return `${sign}${move.toFixed(0)}bp`;
  }
  const sign = move >= 0 ? '+' : '';
  return `${sign}${move.toFixed(1)}%`;
}

function CorrelationBar({ value, highlight }: { value: number; highlight?: boolean }) {
  const width = Math.abs(value) * 100;
  const isNeg = value < 0;
  return (
    <div className="flex items-center gap-1.5">
      <span className={`text-xs font-mono w-12 text-right ${highlight ? 'font-bold text-gray-900 dark:text-white' : 'text-gray-600 dark:text-gray-400'}`}>
        {value >= 0 ? '+' : ''}{value.toFixed(2)}
      </span>
      <div className="w-20 h-2 bg-gray-100 dark:bg-zinc-800 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full ${isNeg ? 'bg-red-400' : highlight ? 'bg-amber-500' : 'bg-blue-400'}`}
          style={{ width: `${width}%` }}
        />
      </div>
    </div>
  );
}

export default function NewsStraddle() {
  const [expandedEvents, setExpandedEvents] = useState<Set<string>>(new Set());

  const toggleEvent = (id: string) => {
    setExpandedEvents((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Compute summary stats
  const avgCorrShift = STRADDLE_EVENTS.reduce((sum, e) => {
    const btcIwn5d = e.correlationShifts.find(c => c.pair === 'BTC-IWN' && c.window.includes('day event'));
    return sum + (btcIwn5d ? btcIwn5d.after - btcIwn5d.before : 0);
  }, 0) / STRADDLE_EVENTS.length;

  const avgBtcMove = STRADDLE_EVENTS.reduce((sum, e) => {
    const btc = e.impacts.find(i => i.asset === 'BTC');
    return sum + (btc ? btc.move : 0);
  }, 0) / STRADDLE_EVENTS.length;

  const avgIwnMove = STRADDLE_EVENTS.reduce((sum, e) => {
    const iwn = e.impacts.find(i => i.asset === 'IWN');
    return sum + (iwn ? iwn.move : 0);
  }, 0) / STRADDLE_EVENTS.length;

  const maxCorrSpike = Math.max(...STRADDLE_EVENTS.map(e => {
    const btcIwn = e.correlationShifts.find(c => c.pair === 'BTC-IWN' && c.window.includes('day event'));
    return btcIwn ? btcIwn.after : 0;
  }));

  return (
    <div>
      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div className="bg-white dark:bg-zinc-950 rounded-lg border border-gray-200 dark:border-zinc-800 p-4">
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-1">Avg BTC-IWN Corr Shift</p>
          <p className="text-2xl font-bold text-amber-600">+{avgCorrShift.toFixed(2)}</p>
          <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">During event windows</p>
        </div>
        <div className="bg-white dark:bg-zinc-950 rounded-lg border border-gray-200 dark:border-zinc-800 p-4">
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-1">Peak BTC-IWN Corr</p>
          <p className="text-2xl font-bold text-red-600">{maxCorrSpike.toFixed(2)}</p>
          <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">Taiwan exercises</p>
        </div>
        <div className="bg-white dark:bg-zinc-950 rounded-lg border border-gray-200 dark:border-zinc-800 p-4">
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-1">Avg BTC Move</p>
          <p className={`text-2xl font-bold ${avgBtcMove < 0 ? 'text-red-600' : 'text-green-600'}`}>
            {avgBtcMove >= 0 ? '+' : ''}{avgBtcMove.toFixed(1)}%
          </p>
          <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">Across all events</p>
        </div>
        <div className="bg-white dark:bg-zinc-950 rounded-lg border border-gray-200 dark:border-zinc-800 p-4">
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-1">Avg IWN Move</p>
          <p className={`text-2xl font-bold ${avgIwnMove < 0 ? 'text-red-600' : 'text-green-600'}`}>
            {avgIwnMove >= 0 ? '+' : ''}{avgIwnMove.toFixed(1)}%
          </p>
          <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">Across all events</p>
        </div>
      </div>

      {/* Model note */}
      <div className="mb-6 px-4 py-3 bg-gray-50 dark:bg-zinc-900 rounded-lg border border-gray-200 dark:border-zinc-800 text-xs text-gray-600 dark:text-gray-400">
        <span className="font-semibold text-gray-700 dark:text-gray-300">Confounding model: </span>
        Partial correlations BTC ↔ IWN controlling for VIX, DXY, 2Y/10Y yields at 3M/6M/12M.
        Events below show how oil supply shocks and geopolitical risk create uncontrolled co-movement channels
        that inflate BTC-IWN correlations beyond what the control variables capture.
      </div>

      {/* Events table */}
      <div className="bg-white dark:bg-zinc-950 rounded-lg border border-gray-200 dark:border-zinc-800 overflow-hidden">
        {/* Table header */}
        <div className="hidden md:grid grid-cols-12 gap-2 px-6 py-3 bg-gray-50 dark:bg-zinc-900 border-b border-gray-200 dark:border-zinc-800 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
          <div className="col-span-3">Event</div>
          <div className="col-span-1 text-right">BTC</div>
          <div className="col-span-1 text-right">IWN</div>
          <div className="col-span-1 text-right">DXY</div>
          <div className="col-span-1 text-right">VIX</div>
          <div className="col-span-1 text-right">USO</div>
          <div className="col-span-2 text-center">BTC-IWN Corr</div>
          <div className="col-span-2 text-center">Impact</div>
        </div>

        {/* Events */}
        <div className="divide-y divide-gray-100 dark:divide-zinc-900">
          {STRADDLE_EVENTS.map((event) => {
            const config = CATEGORY_CONFIG[event.category];
            const Icon = config.icon;
            const isOpen = expandedEvents.has(event.id);
            const btc = event.impacts.find(i => i.asset === 'BTC')!;
            const iwn = event.impacts.find(i => i.asset === 'IWN')!;
            const dxy = event.impacts.find(i => i.asset === 'DXY')!;
            const vix = event.impacts.find(i => i.asset === 'VIX')!;
            const uso = event.impacts.find(i => i.asset === 'USO')!;
            const corrEvent = event.correlationShifts.find(c => c.pair === 'BTC-IWN' && c.window.includes('day event'))!;
            const corrDelta = corrEvent.after - corrEvent.before;
            const isCorrHigh = corrEvent.after >= 0.7;

            return (
              <div key={event.id}>
                <button
                  onClick={() => toggleEvent(event.id)}
                  className="w-full text-left hover:bg-gray-50 dark:hover:bg-zinc-900/50 transition-colors"
                >
                  {/* Desktop row */}
                  <div className="hidden md:grid grid-cols-12 gap-2 px-6 py-3 items-center">
                    <div className="col-span-3 flex items-center gap-2 min-w-0">
                      <Icon className={`w-4 h-4 flex-shrink-0 ${config.color}`} />
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-gray-900 dark:text-white truncate">{event.title}</p>
                        <p className="text-xs text-gray-400 dark:text-gray-500">{event.date}</p>
                      </div>
                    </div>
                    <div className="col-span-1 text-right">
                      <span className={`text-sm font-medium ${btc.move < 0 ? 'text-red-600' : 'text-green-600'}`}>
                        {formatMove(btc.move, 'BTC')}
                      </span>
                    </div>
                    <div className="col-span-1 text-right">
                      <span className={`text-sm font-medium ${iwn.move < 0 ? 'text-red-600' : 'text-green-600'}`}>
                        {formatMove(iwn.move, 'IWN')}
                      </span>
                    </div>
                    <div className="col-span-1 text-right">
                      <span className={`text-sm font-medium ${dxy.move < 0 ? 'text-red-600' : 'text-green-600'}`}>
                        {formatMove(dxy.move, 'DXY')}
                      </span>
                    </div>
                    <div className="col-span-1 text-right">
                      <span className={`text-sm font-medium ${vix.move > 0 ? 'text-red-600' : 'text-green-600'}`}>
                        {formatMove(vix.move, 'VIX')}
                      </span>
                    </div>
                    <div className="col-span-1 text-right">
                      <span className={`text-sm font-medium ${uso.move > 0 ? 'text-amber-600' : 'text-green-600'}`}>
                        {formatMove(uso.move, 'USO')}
                      </span>
                    </div>
                    <div className="col-span-2 flex items-center justify-center gap-1">
                      <span className="text-xs text-gray-400 font-mono">{corrEvent.before.toFixed(2)}</span>
                      <span className="text-xs text-gray-400">→</span>
                      <span className={`text-xs font-mono font-bold ${isCorrHigh ? 'text-red-600' : 'text-amber-600'}`}>
                        {corrEvent.after.toFixed(2)}
                      </span>
                      <span className={`text-xs font-medium ${isCorrHigh ? 'text-red-500' : 'text-amber-500'}`}>
                        (+{corrDelta.toFixed(2)})
                      </span>
                    </div>
                    <div className="col-span-2 flex items-center justify-center">
                      <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                        isCorrHigh
                          ? 'bg-red-100 dark:bg-red-950/30 text-red-600 dark:text-red-400'
                          : 'bg-amber-100 dark:bg-amber-950/30 text-amber-600 dark:text-amber-400'
                      }`}>
                        {isCorrHigh ? 'Breaks Model' : 'Distorts Model'}
                      </span>
                      {isOpen ? <ChevronUp className="w-3 h-3 text-gray-400 ml-2" /> : <ChevronDown className="w-3 h-3 text-gray-400 ml-2" />}
                    </div>
                  </div>

                  {/* Mobile card */}
                  <div className="md:hidden px-4 py-3">
                    <div className="flex items-center gap-2 mb-2">
                      <Icon className={`w-4 h-4 ${config.color}`} />
                      <span className="text-sm font-medium text-gray-900 dark:text-white">{event.title}</span>
                      {isOpen ? <ChevronUp className="w-3 h-3 text-gray-400 ml-auto" /> : <ChevronDown className="w-3 h-3 text-gray-400 ml-auto" />}
                    </div>
                    <div className="flex items-center gap-3 text-xs">
                      <span className="text-gray-400">{event.date}</span>
                      <span className={btc.move < 0 ? 'text-red-600' : 'text-green-600'}>BTC {formatMove(btc.move, 'BTC')}</span>
                      <span className={iwn.move < 0 ? 'text-red-600' : 'text-green-600'}>IWN {formatMove(iwn.move, 'IWN')}</span>
                      <span className={`font-medium ${isCorrHigh ? 'text-red-500' : 'text-amber-500'}`}>
                        ρ {corrEvent.before.toFixed(2)}→{corrEvent.after.toFixed(2)}
                      </span>
                    </div>
                  </div>
                </button>

                {/* Expanded detail */}
                {isOpen && (
                  <div className="px-6 pb-4">
                    <div className="ml-0 md:ml-6 space-y-4">
                      {/* Description */}
                      <p className="text-xs text-gray-600 dark:text-gray-400">{event.description}</p>

                      {/* Full impact grid */}
                      <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-7 gap-3">
                        {event.impacts.map((impact) => (
                          <div key={impact.asset} className="bg-gray-50 dark:bg-zinc-900 rounded p-2">
                            <div className="flex items-center gap-1 mb-0.5">
                              <MoveIcon direction={impact.direction} />
                              <span className="text-xs font-medium text-gray-500 dark:text-gray-400">{impact.asset}</span>
                            </div>
                            <p className={`text-sm font-bold ${
                              impact.asset === 'VIX'
                                ? (impact.move > 0 ? 'text-red-600' : 'text-green-600')
                                : (impact.move < 0 ? 'text-red-600' : 'text-green-600')
                            }`}>
                              {formatMove(impact.move, impact.asset)}
                            </p>
                          </div>
                        ))}
                      </div>

                      {/* Correlation shifts */}
                      <div className="bg-gray-50 dark:bg-zinc-900 rounded-lg p-3 border border-gray-200 dark:border-zinc-800">
                        <p className="text-xs font-semibold text-gray-700 dark:text-gray-300 mb-2">Correlation Shifts</p>
                        <div className="space-y-2">
                          {event.correlationShifts.map((cs, i) => (
                            <div key={i} className="flex items-center gap-3 text-xs">
                              <span className={`font-medium w-16 ${cs.pair === 'BTC-IWN' ? 'text-gray-900 dark:text-white' : 'text-gray-500 dark:text-gray-400'}`}>
                                {cs.pair}
                              </span>
                              <span className="text-gray-400 w-20">{cs.window}</span>
                              <div className="flex items-center gap-2">
                                <CorrelationBar value={cs.before} />
                                <span className="text-gray-400">→</span>
                                <CorrelationBar value={cs.after} highlight={cs.pair === 'BTC-IWN'} />
                              </div>
                              <span className={`font-medium ml-auto ${
                                Math.abs(cs.after) > Math.abs(cs.before) ? 'text-red-500' : 'text-green-500'
                              }`}>
                                {cs.after > cs.before ? '+' : ''}{(cs.after - cs.before).toFixed(2)}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* Confounding analysis */}
                      <div className={`rounded-lg p-3 border ${config.border} ${config.bg}`}>
                        <p className={`text-xs font-semibold ${config.color} mb-1`}>
                          Confounding Analysis — BTC ↔ IWN
                        </p>
                        <p className="text-xs text-gray-600 dark:text-gray-400 leading-relaxed">
                          {event.confoundingNote}
                        </p>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
