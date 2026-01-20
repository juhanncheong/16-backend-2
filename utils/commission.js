function calcCommission(price, isBonus) {
  const rate = isBonus ? 0.10 : 0.01;
  return Math.round(price * rate * 100) / 100; // keep 2 decimals
}

module.exports = { calcCommission };
