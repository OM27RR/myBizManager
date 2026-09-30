const dns = require("dns");

dns.setServers(["8.8.8.8", "8.8.4.4"]);

const app = require('./app');
const config = require('./core/config');
const { connectDB } = require('./database/mongodb');

connectDB().then(() => {
  app.listen(config.port, () => {
    console.log(`Server running on primary port ${config.port} [${config.nodeEnv}]`);
  });

  if (config.port !== 5000) {
    const secondary = app.listen(5000, () => {
      console.log(`Server also listening on port 5000 for dual-port compatibility`);
    });
    secondary.on('error', (err) => {
      console.log(`Note: port 5000 secondary skipped (${err.message})`);
    });
  }
});