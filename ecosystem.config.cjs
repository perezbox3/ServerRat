module.exports = {
  apps: [
    {
      name: 'serverrat',
      script: './server/index.js',
      interpreter: 'node',
      instances: 1,
      autorestart: true,
      watch: false,
      env: {
        NODE_ENV: 'production',
        PORT: 3003,
      },
    },
    {
      name: 'serverrat-collector',
      script: './scripts/collect.js',
      interpreter: 'node',
      instances: 1,
      autorestart: false,    // don't restart on crash — wait for next cron tick
      cron_restart: '0 */3 * * *',  // run every 3 hours
      watch: false,
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
}
