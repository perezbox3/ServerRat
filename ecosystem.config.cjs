module.exports = {
  apps: [{
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
  }],
}
