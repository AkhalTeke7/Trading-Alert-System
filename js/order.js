
const apiKey = process.env.TWELVE_API_KEY;

function getDateRangeUTCMinus4() {
  const now = new Date();

  // زمان فعلی بر اساس UTC-4
  const current = new Date(
    now.getTime() - 4 * 60 * 60 * 1000
  );

  // زمان پایان: همین الان
  const end_date = current
    .toISOString()
    .replace("T", " ")
    .slice(0, 19);

  // زمان شروع: ساعت صفرِ دو روز قبل
  const start = new Date(current);
  start.setUTCDate(start.getUTCDate() - 2);

  const start_date =
    start.toISOString().slice(0, 10) + " 00:00:00";

  return { start_date, end_date };
}

// اجرا
const { start_date, end_date } = getDateRangeUTCMinus4();

console.log("Start:", start_date);
console.log("End:", end_date);

async function fiftyCandles(pair="XAU") {
    const { start_date, end_date } = getDateRangeUTCMinus4();
    const url = `https://api.twelvedata.com/time_series?symbol=${pair}%2FUSD&interval=15min&start_date=${start_date}&end_date=${end_date}&timezone=UTC-4&apikey=${apiKey}`
    const response = await fetch(url);
    const fiftydata = await response.json();
    return fiftydata;
};
async function thirtyCandles(pair="XAU") {
    const { start_date, end_date } = getDateRangeUTCMinus4();
    const url = `https://api.twelvedata.com/time_series?symbol=${pair}%2FUSD&interval=30min&start_date=${start_date}&end_date=${end_date}&timezone=UTC-4&apikey=${apiKey}`
    const response = await fetch(url);
    const thirtydata = await response.json();
    return thirtydata;
};

async function lowHigh(pair="XAU") {
    const [fifty, thirty] = await Promise.all([
        fiftyCandles(pair),
        thirtyCandles(pair)
    ]);

    const lowF = [...fifty.values.map(candle => candle.low)];
    const highF = [...fifty.values.map(candle => candle.high)];
    const lowT = [...thirty.values.map(candle => candle.low)];
    const highT = [...thirty.values.map(candle => candle.high)];

    return { lowF, highF, lowT, highT };
};
async function direction() {
    const { lowF, highF, lowT, highT } = await lowHigh();
}