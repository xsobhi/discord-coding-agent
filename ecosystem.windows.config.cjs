// Windows: run through scripts/pm2-windows.cjs (see README, "Windows"). PM2 has no SIGTERM on Windows, so
// `shutdown_with_message` makes it send a 'shutdown' message that src/index.ts answers by closing cleanly.
// No `env` here on purpose: the agent's shell inherits it, and NODE_ENV=production would make its own
// `npm ci` skip devDependencies.
module.exports = {
  apps: [{
    name: 'discord-agent',
    script: 'src/index.ts',
    cwd: __dirname,
    interpreter: process.execPath,
    exec_mode: 'fork',
    instances: 1,
    watch: false,
    autorestart: true,
    restart_delay: 5000,
    kill_timeout: 8000,
    shutdown_with_message: true,
    max_memory_restart: '1500M',
  }],
};
