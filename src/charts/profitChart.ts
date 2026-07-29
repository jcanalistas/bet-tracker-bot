import sharp from "sharp";
import type { ProfitPoint } from "../stats/betsStore";
import { formatMoney } from "../stats/betsStore";

const WIDTH = 800;
const HEIGHT = 420;
const PADDING_LEFT = 60;
const PADDING_RIGHT = 30;
const PADDING_TOP = 50;
const PADDING_BOTTOM = 40;

/** Dibuja la evolución del beneficio acumulado (un punto por apuesta resuelta, en orden cronológico) y lo rasteriza a PNG. Requiere al menos 2 puntos. */
export async function renderProfitChart(points: ProfitPoint[]): Promise<Buffer> {
  const plotWidth = WIDTH - PADDING_LEFT - PADDING_RIGHT;
  const plotHeight = HEIGHT - PADDING_TOP - PADDING_BOTTOM;

  const values = [0, ...points.map((p) => p.cumulativeProfit)];
  const minValue = Math.min(...values);
  const maxValue = Math.max(...values);
  const range = maxValue - minValue || 1;

  const xStep = plotWidth / (points.length - 1);
  const xFor = (index: number) => PADDING_LEFT + index * xStep;
  const yFor = (value: number) => PADDING_TOP + plotHeight - ((value - minValue) / range) * plotHeight;

  const linePoints = points.map((p, i) => `${xFor(i).toFixed(1)},${yFor(p.cumulativeProfit).toFixed(1)}`);
  const areaPoints = [
    `${xFor(0).toFixed(1)},${yFor(0).toFixed(1)}`,
    ...linePoints,
    `${xFor(points.length - 1).toFixed(1)},${yFor(0).toFixed(1)}`,
  ];

  const finalProfit = points[points.length - 1].cumulativeProfit;
  const positive = finalProfit >= 0;
  const lineColor = positive ? "#16a34a" : "#dc2626";
  const areaColor = positive ? "rgba(22,163,74,0.15)" : "rgba(220,38,38,0.15)";
  const zeroY = yFor(0).toFixed(1);

  const circles = points
    .map((p, i) => `<circle cx="${xFor(i).toFixed(1)}" cy="${yFor(p.cumulativeProfit).toFixed(1)}" r="3.5" fill="${lineColor}" />`)
    .join("");

  const finalLabel = `${positive ? "+" : ""}${formatMoney(finalProfit)}€`;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}">
  <rect width="${WIDTH}" height="${HEIGHT}" fill="#ffffff" />
  <text x="${PADDING_LEFT}" y="28" font-family="sans-serif" font-size="20" font-weight="bold" fill="#111827">Evolución del beneficio</text>
  <line x1="${PADDING_LEFT}" y1="${zeroY}" x2="${WIDTH - PADDING_RIGHT}" y2="${zeroY}" stroke="#9ca3af" stroke-width="1" stroke-dasharray="4,4" />
  <polygon points="${areaPoints.join(" ")}" fill="${areaColor}" />
  <polyline points="${linePoints.join(" ")}" fill="none" stroke="${lineColor}" stroke-width="2.5" />
  ${circles}
  <text x="${WIDTH - PADDING_RIGHT}" y="${PADDING_TOP - 8}" font-family="sans-serif" font-size="16" font-weight="bold" fill="${lineColor}" text-anchor="end">${finalLabel}</text>
  <text x="${PADDING_LEFT}" y="${HEIGHT - 12}" font-family="sans-serif" font-size="12" fill="#6b7280">Apuesta 1</text>
  <text x="${WIDTH - PADDING_RIGHT}" y="${HEIGHT - 12}" font-family="sans-serif" font-size="12" fill="#6b7280" text-anchor="end">Apuesta ${points.length}</text>
</svg>`;

  return sharp(Buffer.from(svg)).png().toBuffer();
}
