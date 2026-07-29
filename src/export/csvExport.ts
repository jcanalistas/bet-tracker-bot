import type { Bet } from "../stats/betsStore";
import { formatMoney } from "../stats/betsStore";

// ";" en vez de "," como separador: las cifras ya usan coma decimal
// (formatMoney), y Excel en español espera justo ";" como delimitador de
// lista cuando la coma es el separador decimal.
const DELIMITER = ";";

function escapeCsvField(value: string): string {
  if (/[;"\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function formatDate(ts: number): string {
  return new Date(ts).toISOString();
}

export function betsToCsv(bets: Bet[]): string {
  const header = [
    "Fecha registro",
    "Deporte",
    "Partido",
    "Tipo",
    "Cuota estimada",
    "Importe",
    "Estado",
    "Fecha resolución",
    "Cuota real",
    "Beneficio",
  ];

  const rows = bets.map((b) => [
    formatDate(b.createdAt),
    b.sport,
    b.match,
    b.betType,
    b.estimatedOdds !== null ? formatMoney(b.estimatedOdds) : "",
    formatMoney(b.stake),
    b.status,
    b.resolvedAt ? formatDate(b.resolvedAt) : "",
    b.realOdds !== undefined ? formatMoney(b.realOdds) : "",
    b.profit !== undefined ? formatMoney(b.profit) : "",
  ]);

  return [header, ...rows].map((row) => row.map(escapeCsvField).join(DELIMITER)).join("\n");
}
