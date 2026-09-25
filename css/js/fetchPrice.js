fetch('https://www.tradingview.com/symbols/COMEX-GC1!/')
  .then(response => {
    console.log(response.status);
    return response.text();
  })
  .then(data => console.log(data))
  .catch(error => console.error(error));