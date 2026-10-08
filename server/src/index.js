const { boot } = require('./boot');

boot().then(() => {
  const port = process.env.PORT || 4000;
  require('./app').listen(port, () => console.log(`WorkTrack running on http://localhost:${port}`));
}).catch((e) => { console.error(e); process.exit(1); });
