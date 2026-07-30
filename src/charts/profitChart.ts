import sharp from "sharp";
import type { ProfitTimelinePoint } from "../stats/betsStore";
import { formatMoney } from "../stats/betsStore";

const WIDTH = 800;
const HEIGHT = 440;
const PADDING_LEFT = 60;
const PADDING_RIGHT = 30;
const PADDING_TOP = 50;
const PADDING_BOTTOM = 50;
// Con más franjas que esto, se van saltando etiquetas para que no se
// amontonen (siempre se muestra la primera y la última).
const MAX_X_LABELS = 9;

/**
 * Dibuja la evolución del beneficio acumulado, una franja de tiempo por
 * punto (ver getProfitTimeline: cada 2 días en "mes", cada semana en
 * "año", cada mes en "histórico") y lo rasteriza a PNG. Requiere al menos
 * 2 puntos.
 */
export async function renderProfitChart(points: ProfitTimelinePoint[]): Promise<Buffer> {
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
    .map((p, i) => `<circle cx="${xFor(i).toFixed(1)}" cy="${yFor(p.cumulativeProfit).toFixed(1)}" r="3" fill="${lineColor}" />`)
    .join("");

  const labelStep = Math.max(1, Math.ceil(points.length / MAX_X_LABELS));
  const gridAndLabels = points
    .map((p, i) => {
      const isLast = i === points.length - 1;
      if (i % labelStep !== 0 && !isLast) return "";
      const x = xFor(i).toFixed(1);
      return (
        `<line x1="${x}" y1="${PADDING_TOP}" x2="${x}" y2="${HEIGHT - PADDING_BOTTOM}" stroke="#e5e7eb" stroke-width="1" />` +
        `<text x="${x}" y="${HEIGHT - PADDING_BOTTOM + 20}" font-family="sans-serif" font-size="12" fill="#6b7280" text-anchor="middle">${p.label}</text>`
      );
    })
    .join("");

  const finalLabel = `${positive ? "+" : ""}${formatMoney(finalProfit)}€`;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}">
  <rect width="${WIDTH}" height="${HEIGHT}" fill="#ffffff" />
  <text x="${PADDING_LEFT}" y="28" font-family="sans-serif" font-size="20" font-weight="bold" fill="#111827">Evolución del beneficio</text>
  ${gridAndLabels}
  <line x1="${PADDING_LEFT}" y1="${zeroY}" x2="${WIDTH - PADDING_RIGHT}" y2="${zeroY}" stroke="#9ca3af" stroke-width="1" stroke-dasharray="4,4" />
  <polygon points="${areaPoints.join(" ")}" fill="${areaColor}" />
  <polyline points="${linePoints.join(" ")}" fill="none" stroke="${lineColor}" stroke-width="2.5" />
  ${circles}
  <text x="${WIDTH - PADDING_RIGHT}" y="${PADDING_TOP - 8}" font-family="sans-serif" font-size="16" font-weight="bold" fill="${lineColor}" text-anchor="end">${finalLabel}</text>
</svg>`;

  return sharp(Buffer.from(svg)).png().toBuffer();
}
