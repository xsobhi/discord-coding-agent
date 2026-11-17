// A PM2 runtime of its own for this bot on Windows: node scripts/pm2-windows.cjs run|status|restart|stop
// `run` hosts PM2 inside this process and keeps running (that is what the boot-time Scheduled Task launches).
// It never attaches to another PM2 on the machine (for example a service): it has its own PM2 home and pipes.
// PM2 itself must be installed globally (npm i -g pm2); set PM2_LIB to its lib/API.js if it is somewhere unusual.
const path = require('node:path');
const fs = require('node:fs');
const root = path.resolve(__dirname, '..');
const ecosystem = path.join(root, 'ecosystem.windows.config.cjs');
const name = require(ecosystem).apps[0].name;
const command = process.argv[2] || 'status';
if (!['run', 'status', 'restart', 'stop'].includes(command)) throw new Error('Use run, status, restart or stop');
process.env.PM2_HOME = path.join(root, 'data', 'pm2');
process.env.PM2_DISCRETE_MODE = 'true';
const lib = [process.env.PM2_LIB, path.join(process.env.APPDATA || '', 'npm/node_modules/pm2/lib/API.js'),
  path.join(path.dirname(process.execPath), 'node_modules/pm2/lib/API.js')].filter(Boolean).find((p) => fs.existsSync(p));
if (!lib) throw new Error('PM2 not found: npm i -g pm2 (or set PM2_LIB to its lib/API.js)');
const API = require(lib);
const pm2 = new API({ pm2_home: process.env.PM2_HOME, daemon_mode: command !== 'run' });
// PM2 hardcodes shared pipe names on Windows even with its own PM2_HOME, which would collide with another PM2.
// Point only this API instance at pipes named after the app; the installed PM2 is left untouched.
pm2._conf.DAEMON_RPC_PORT = `\\\\.\\pipe\\${name}-rpc.sock`;
pm2._conf.DAEMON_PUB_PORT = `\\\\.\\pipe\\${name}-pub.sock`;
pm2._conf.INTERACTOR_RPC_PORT = `\\\\.\\pipe\\${name}-interactor.sock`;
pm2.Client.rpc_socket_file = pm2._conf.DAEMON_RPC_PORT;
pm2.Client.pub_socket_file = pm2._conf.DAEMON_PUB_PORT;
const fail = (err) => { console.error(err.message || String(err)); pm2.disconnect(() => process.exit(1)); };
const done = () => pm2.disconnect();
pm2.Client.pingDaemon((alive) => {
  if (command === 'run' && alive) return done();
  if (command !== 'run' && !alive) return fail(new Error(`The PM2 runtime for ${name} is not running`));
  // Patch the God.js of the very PM2 this launcher loaded (next to its API.js).
  if (command === 'run') require('./pm2-windows-guard.cjs')(require(path.join(path.dirname(lib), 'God.js')));
  pm2.connect((err) => {
    if (err) return fail(err);
    if (command === 'run') {
      return pm2.start(ecosystem, (error) => {
        if (error) return fail(error);
        pm2.dump(false, (dumpError) => dumpError ? fail(dumpError) : done());
      });
    }
    if (command === 'status') return pm2.list((error, list) => {
      if (error) return fail(error);
      const out = list.map((p) => ({ name: p.name, pid: p.pid, status: p.pm2_env.status,
        cwd: p.pm2_env.pm_cwd, restarts: p.pm2_env.restart_time, uptime: p.pm2_env.pm_uptime }));
      console.log(JSON.stringify(out, null, 2)); done();
    });
    pm2[command](name, (error) => error ? fail(error) : done());
  });
});
