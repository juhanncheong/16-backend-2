function calcCommission(price, rate) {
  const p = Number(price);
  const r = Number(rate);

  if (!Number.isFinite(p) || p <= 0) return 0;
  if (!Number.isFinite(r) || r < 0) return 0;

  return Math.round(p * r * 100) / 100;
}

module.exports = { calcCommission };
