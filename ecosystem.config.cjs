// PM2: `pm2 start ecosystem.config.cjs && pm2 save`
// The agent's shell tool inherits the environment pm2 was started from, so start pm2 from a login
// shell where `claude` and `codex` are on PATH. Do not pass the Discord token through here: the bot
// reads .env itself.
module.exports = {
  apps: [{
    name: 'discord-agent',
    script: 'src/index.ts',
    cwd: __dirname,
    interpreter: 'node',
    // restart_self makes the bot exit cleanly; PM2 starts it again.
    autorestart: true,
    kill_timeout: 8000,
    max_memory_restart: '1500M',
  }],
};
