import { NextRequest, NextResponse } from 'next/server';
import type { SectorHoldingsInfo } from '@/types';

// Espejo sintético de /api/sector-holdings: composición fija por ETF sectorial
// en vez de pegarle a Yahoo. Los holdings son las empresas reales más pesadas
// de cada sector (dato público, no depende de la cartera) con pesos aproximados
// y no oficiales — alcanza para que la demo se vea plausible.
const HOLDINGS_DEMO: Record<string, Omit<SectorHoldingsInfo, 'ticker'>> = {
  XLE: {
    gestora: 'State Street Investment Management', expenseRatio: 0.0008,
    holdings: [
      { symbol: 'XOM', nombre: 'ExxonMobil Corp', peso: 0.205 },
      { symbol: 'CVX', nombre: 'Chevron Corp', peso: 0.152 },
      { symbol: 'COP', nombre: 'ConocoPhillips', peso: 0.061 },
      { symbol: 'MPC', nombre: 'Marathon Petroleum Corp', peso: 0.049 },
      { symbol: 'PSX', nombre: 'Phillips 66', peso: 0.049 },
      { symbol: 'VLO', nombre: 'Valero Energy Corp', peso: 0.047 },
      { symbol: 'EOG', nombre: 'EOG Resources Inc', peso: 0.046 },
      { symbol: 'WMB', nombre: 'Williams Companies Inc', peso: 0.043 },
      { symbol: 'KMI', nombre: 'Kinder Morgan Inc', peso: 0.038 },
      { symbol: 'OKE', nombre: 'ONEOK Inc', peso: 0.036 },
    ],
  },
  XLK: {
    gestora: 'State Street Investment Management', expenseRatio: 0.0008,
    holdings: [
      { symbol: 'NVDA', nombre: 'NVIDIA Corp', peso: 0.14 },
      { symbol: 'MSFT', nombre: 'Microsoft Corp', peso: 0.13 },
      { symbol: 'AAPL', nombre: 'Apple Inc', peso: 0.12 },
      { symbol: 'AVGO', nombre: 'Broadcom Inc', peso: 0.07 },
      { symbol: 'CRM', nombre: 'Salesforce Inc', peso: 0.04 },
      { symbol: 'ORCL', nombre: 'Oracle Corp', peso: 0.035 },
      { symbol: 'AMD', nombre: 'Advanced Micro Devices Inc', peso: 0.03 },
      { symbol: 'ADBE', nombre: 'Adobe Inc', peso: 0.028 },
      { symbol: 'CSCO', nombre: 'Cisco Systems Inc', peso: 0.025 },
      { symbol: 'ACN', nombre: 'Accenture plc', peso: 0.024 },
    ],
  },
  SMH: {
    gestora: 'VanEck', expenseRatio: 0.0035,
    holdings: [
      { symbol: 'NVDA', nombre: 'NVIDIA Corp', peso: 0.20 },
      { symbol: 'TSM', nombre: 'Taiwan Semiconductor Mfg Co', peso: 0.12 },
      { symbol: 'AVGO', nombre: 'Broadcom Inc', peso: 0.08 },
      { symbol: 'AMD', nombre: 'Advanced Micro Devices Inc', peso: 0.05 },
      { symbol: 'QCOM', nombre: 'Qualcomm Inc', peso: 0.045 },
      { symbol: 'TXN', nombre: 'Texas Instruments Inc', peso: 0.042 },
      { symbol: 'AMAT', nombre: 'Applied Materials Inc', peso: 0.04 },
      { symbol: 'INTC', nombre: 'Intel Corp', peso: 0.035 },
      { symbol: 'LRCX', nombre: 'Lam Research Corp', peso: 0.033 },
      { symbol: 'ADI', nombre: 'Analog Devices Inc', peso: 0.03 },
    ],
  },
  XLV: {
    gestora: 'State Street Investment Management', expenseRatio: 0.0008,
    holdings: [
      { symbol: 'LLY', nombre: 'Eli Lilly and Co', peso: 0.11 },
      { symbol: 'UNH', nombre: 'UnitedHealth Group Inc', peso: 0.09 },
      { symbol: 'JNJ', nombre: 'Johnson & Johnson', peso: 0.07 },
      { symbol: 'ABBV', nombre: 'AbbVie Inc', peso: 0.06 },
      { symbol: 'MRK', nombre: 'Merck & Co Inc', peso: 0.05 },
      { symbol: 'ABT', nombre: 'Abbott Laboratories', peso: 0.04 },
      { symbol: 'TMO', nombre: 'Thermo Fisher Scientific Inc', peso: 0.038 },
      { symbol: 'ISRG', nombre: 'Intuitive Surgical Inc', peso: 0.035 },
      { symbol: 'PFE', nombre: 'Pfizer Inc', peso: 0.028 },
      { symbol: 'DHR', nombre: 'Danaher Corp', peso: 0.026 },
    ],
  },
  XLF: {
    gestora: 'State Street Investment Management', expenseRatio: 0.0008,
    holdings: [
      { symbol: 'BRK-B', nombre: 'Berkshire Hathaway Inc', peso: 0.13 },
      { symbol: 'JPM', nombre: 'JPMorgan Chase & Co', peso: 0.11 },
      { symbol: 'V', nombre: 'Visa Inc', peso: 0.08 },
      { symbol: 'MA', nombre: 'Mastercard Inc', peso: 0.07 },
      { symbol: 'BAC', nombre: 'Bank of America Corp', peso: 0.05 },
      { symbol: 'WFC', nombre: 'Wells Fargo & Co', peso: 0.04 },
      { symbol: 'GS', nombre: 'Goldman Sachs Group Inc', peso: 0.035 },
      { symbol: 'SPGI', nombre: 'S&P Global Inc', peso: 0.03 },
      { symbol: 'MS', nombre: 'Morgan Stanley', peso: 0.028 },
      { symbol: 'AXP', nombre: 'American Express Co', peso: 0.026 },
    ],
  },
  XLI: {
    gestora: 'State Street Investment Management', expenseRatio: 0.0008,
    holdings: [
      { symbol: 'GE', nombre: 'GE Aerospace', peso: 0.06 },
      { symbol: 'CAT', nombre: 'Caterpillar Inc', peso: 0.05 },
      { symbol: 'RTX', nombre: 'RTX Corp', peso: 0.048 },
      { symbol: 'UBER', nombre: 'Uber Technologies Inc', peso: 0.045 },
      { symbol: 'HON', nombre: 'Honeywell International Inc', peso: 0.04 },
      { symbol: 'UNP', nombre: 'Union Pacific Corp', peso: 0.038 },
      { symbol: 'ADP', nombre: 'Automatic Data Processing Inc', peso: 0.032 },
      { symbol: 'BA', nombre: 'Boeing Co', peso: 0.03 },
      { symbol: 'DE', nombre: 'Deere & Co', peso: 0.028 },
      { symbol: 'LMT', nombre: 'Lockheed Martin Corp', peso: 0.026 },
    ],
  },
  XLY: {
    gestora: 'State Street Investment Management', expenseRatio: 0.0008,
    holdings: [
      { symbol: 'AMZN', nombre: 'Amazon.com Inc', peso: 0.23 },
      { symbol: 'TSLA', nombre: 'Tesla Inc', peso: 0.13 },
      { symbol: 'HD', nombre: 'Home Depot Inc', peso: 0.08 },
      { symbol: 'MCD', nombre: "McDonald's Corp", peso: 0.045 },
      { symbol: 'BKNG', nombre: 'Booking Holdings Inc', peso: 0.04 },
      { symbol: 'LOW', nombre: "Lowe's Companies Inc", peso: 0.035 },
      { symbol: 'TJX', nombre: 'TJX Companies Inc', peso: 0.032 },
      { symbol: 'SBUX', nombre: 'Starbucks Corp', peso: 0.026 },
      { symbol: 'NKE', nombre: 'Nike Inc', peso: 0.022 },
      { symbol: 'CMG', nombre: 'Chipotle Mexican Grill Inc', peso: 0.02 },
    ],
  },
  XLP: {
    gestora: 'State Street Investment Management', expenseRatio: 0.0008,
    holdings: [
      { symbol: 'COST', nombre: 'Costco Wholesale Corp', peso: 0.15 },
      { symbol: 'WMT', nombre: 'Walmart Inc', peso: 0.13 },
      { symbol: 'PG', nombre: 'Procter & Gamble Co', peso: 0.11 },
      { symbol: 'KO', nombre: 'Coca-Cola Co', peso: 0.09 },
      { symbol: 'PEP', nombre: 'PepsiCo Inc', peso: 0.07 },
      { symbol: 'PM', nombre: 'Philip Morris International Inc', peso: 0.055 },
      { symbol: 'MO', nombre: 'Altria Group Inc', peso: 0.032 },
      { symbol: 'MDLZ', nombre: 'Mondelez International Inc', peso: 0.03 },
      { symbol: 'CL', nombre: 'Colgate-Palmolive Co', peso: 0.028 },
      { symbol: 'TGT', nombre: 'Target Corp', peso: 0.02 },
    ],
  },
  XLU: {
    gestora: 'State Street Investment Management', expenseRatio: 0.0008,
    holdings: [
      { symbol: 'NEE', nombre: 'NextEra Energy Inc', peso: 0.10 },
      { symbol: 'SO', nombre: 'Southern Co', peso: 0.07 },
      { symbol: 'DUK', nombre: 'Duke Energy Corp', peso: 0.065 },
      { symbol: 'CEG', nombre: 'Constellation Energy Corp', peso: 0.06 },
      { symbol: 'AEP', nombre: 'American Electric Power Co', peso: 0.045 },
      { symbol: 'D', nombre: 'Dominion Energy Inc', peso: 0.04 },
      { symbol: 'EXC', nombre: 'Exelon Corp', peso: 0.036 },
      { symbol: 'SRE', nombre: 'Sempra', peso: 0.034 },
      { symbol: 'XEL', nombre: 'Xcel Energy Inc', peso: 0.032 },
      { symbol: 'PEG', nombre: 'Public Service Enterprise Group Inc', peso: 0.03 },
    ],
  },
  XLB: {
    gestora: 'State Street Investment Management', expenseRatio: 0.0008,
    holdings: [
      { symbol: 'LIN', nombre: 'Linde plc', peso: 0.20 },
      { symbol: 'SHW', nombre: 'Sherwin-Williams Co', peso: 0.08 },
      { symbol: 'ECL', nombre: 'Ecolab Inc', peso: 0.06 },
      { symbol: 'FCX', nombre: 'Freeport-McMoRan Inc', peso: 0.055 },
      { symbol: 'APD', nombre: 'Air Products and Chemicals Inc', peso: 0.05 },
      { symbol: 'NEM', nombre: 'Newmont Corp', peso: 0.045 },
      { symbol: 'CTVA', nombre: 'Corteva Inc', peso: 0.04 },
      { symbol: 'DD', nombre: 'DuPont de Nemours Inc', peso: 0.035 },
      { symbol: 'NUE', nombre: 'Nucor Corp', peso: 0.03 },
      { symbol: 'PPG', nombre: 'PPG Industries Inc', peso: 0.028 },
    ],
  },
  XLRE: {
    gestora: 'State Street Investment Management', expenseRatio: 0.0008,
    holdings: [
      { symbol: 'PLD', nombre: 'Prologis Inc', peso: 0.11 },
      { symbol: 'AMT', nombre: 'American Tower Corp', peso: 0.08 },
      { symbol: 'EQIX', nombre: 'Equinix Inc', peso: 0.07 },
      { symbol: 'WELL', nombre: 'Welltower Inc', peso: 0.065 },
      { symbol: 'DLR', nombre: 'Digital Realty Trust Inc', peso: 0.05 },
      { symbol: 'SPG', nombre: 'Simon Property Group Inc', peso: 0.045 },
      { symbol: 'PSA', nombre: 'Public Storage', peso: 0.04 },
      { symbol: 'O', nombre: 'Realty Income Corp', peso: 0.038 },
      { symbol: 'CCI', nombre: 'Crown Castle Inc', peso: 0.032 },
      { symbol: 'CBRE', nombre: 'CBRE Group Inc', peso: 0.03 },
    ],
  },
  XLC: {
    gestora: 'State Street Investment Management', expenseRatio: 0.0008,
    holdings: [
      { symbol: 'META', nombre: 'Meta Platforms Inc', peso: 0.22 },
      { symbol: 'GOOGL', nombre: 'Alphabet Inc Class A', peso: 0.13 },
      { symbol: 'GOOG', nombre: 'Alphabet Inc Class C', peso: 0.11 },
      { symbol: 'NFLX', nombre: 'Netflix Inc', peso: 0.07 },
      { symbol: 'TMUS', nombre: 'T-Mobile US Inc', peso: 0.045 },
      { symbol: 'DIS', nombre: 'Walt Disney Co', peso: 0.04 },
      { symbol: 'CMCSA', nombre: 'Comcast Corp', peso: 0.035 },
      { symbol: 'VZ', nombre: 'Verizon Communications Inc', peso: 0.028 },
      { symbol: 'T', nombre: 'AT&T Inc', peso: 0.025 },
      { symbol: 'EA', nombre: 'Electronic Arts Inc', peso: 0.014 },
    ],
  },
};

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const ticker = url.searchParams.get('ticker')?.toUpperCase();
  if (!ticker) {
    return NextResponse.json({ error: 'Falta query param ticker' }, { status: 400 });
  }

  const info = HOLDINGS_DEMO[ticker];
  if (!info) {
    return NextResponse.json({ error: `Sin datos de composición para ${ticker}` }, { status: 404 });
  }

  const body: SectorHoldingsInfo = { ticker, ...info };
  return NextResponse.json(body);
}
