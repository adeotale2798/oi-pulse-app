const COLUMNS = [
  ["month", "Month"],
  ["coverage_from", "Coverage from"],
  ["coverage_to", "Coverage to"],
  ["currency", "Currency"],
  ["successful_charges", "Successful payments"],
  ["charges_with_amounts", "Payments with amount"],
  ["amount_coverage_percent", "Amount coverage percent"],
  ["gross_collected", "Gross collected"],
  ["refund_increases", "Refund increases"],
  ["refunded", "Refunded"],
  ["net_collected", "Net collected"],
];

function csvCell(value) {
  const text = String(value ?? "");
  const numeric = typeof value === "number" || (typeof value === "string" && /^-?\d+(\.\d+)?$/.test(value));
  const safe = !numeric && /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return `"${safe.replaceAll('"', '""')}"`;
}

function moneyFromMinor(value) {
  return (Number(value) / 100 || 0).toFixed(2);
}

export function membershipReconciliationCsv(rows, currency = "INR") {
  const records = (Array.isArray(rows) ? rows : []).map((row) => {
    const charges = Number(row.successful_charges) || 0;
    const amountCount = Number(row.charges_with_amounts) || 0;
    const values = {
      month: row.month,
      coverage_from: row.coverage_from,
      coverage_to: row.coverage_to,
      currency,
      successful_charges: charges,
      charges_with_amounts: amountCount,
      amount_coverage_percent: charges ? (amountCount / charges * 100).toFixed(1) : "0.0",
      gross_collected: moneyFromMinor(row.gross_collected_minor),
      refund_increases: Number(row.refund_increases) || 0,
      refunded: moneyFromMinor(row.refunded_minor),
      net_collected: moneyFromMinor(row.net_collected_minor),
    };
    return COLUMNS.map(([key]) => values[key]);
  });
  return [
    COLUMNS.map(([, label]) => label),
    ...records,
  ].map((row) => row.map(csvCell).join(",")).join("\r\n");
}
