import getPrices from "./fetchPrice.js";

try {
  const prices = await getPrices();
  console.log(JSON.stringify(prices, null, 2));
} catch (error) {
  console.error("Failed to fetch prices:", error);
  process.exitCode = 1;
}
