const assert = require('node:assert/strict');
const { mkdtempSync, rmSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const guard = require('./pm2-windows-guard.cjs');

// Find God.js the way the launcher finds PM2: PM2_LIB, global npm (Windows), next to node, then a local install.
function findGod() {
  const lib = [process.env.PM2_LIB, path.join(process.env.APPDATA || '', 'npm/node_modules/pm2/lib/API.js'),
    path.join(path.dirname(process.execPath), 'node_modules/pm2/lib/API.js')].filter(Boolean).find((p) => require('node:fs').existsSync(p));
  if (lib) return path.join(path.dirname(lib), 'God.js');
  try { return require.resolve('pm2/lib/God.js'); } catch { return null; }
}

async function main() {
  const godPath = process.platform === 'win32' ? findGod() : null;
  if (!godPath) { console.log('PM2 guard test skipped: needs Windows with PM2 installed'); return; }
  const scratch = mkdtempSync(path.join(tmpdir(), 'pm2-exit-regression-'));
  process.env.PM2_HOME = scratch;
  writeFileSync(path.join(scratch, 'module_conf.json'), '{}');
  // Exercise the installed PM2 code without starting a daemon, Discord or model.
  const God = require(godPath);
  let launches = 0;
  God.executeApp = () => { launches++; };
  God.notify = () => {};
  const fixture = (pid) => ({ process: { pid }, pm2_env: {
    pm_id: 0, name: 'offline-fixture', status: 'online', autorestart: true,
    pm_pid_path: path.join(scratch, 'fixture.pid'), created_at: 0, pm_uptime: 0,
    restart_delay: 5, restart_time: 0,
  } });
  const old = fixture(100);
  const replacement = fixture(200);
  try {
    God.clusters_db[0] = replacement;
    God.handleExit(old, 0);
    await new Promise((resolve) => setTimeout(resolve, 20));
    const reproduced = launches === 1; // a newer PM2 may have fixed this itself
    launches = 0;
    God.clusters_db[0] = fixture(300);
    guard(God);
    guard(God); // Installation is idempotent.
    God.handleExit(old, 0);
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(launches, 0, 'stale exit cannot spawn a duplicate');
    assert.equal(God.clusters_db[0].pm2_env.status, 'online');
    God.handleExit(God.clusters_db[0], 0);
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(launches, 1, 'current child exit still triggers normal recovery');
    let checked = false;
    God.processIsDead = (pid, env, done) => {
      assert.equal(pid, 400);
      assert.equal(env._tree_pids, undefined, 'stale tree PID list cleared before exit check');
      checked = true;
      done();
    };
    const current = fixture(400);
    current.send = () => {};
    current.pm2_env.shutdown_with_message = true;
    current.pm2_env._tree_pids = [100];
    God.clusters_db[0] = current;
    God.killProcess(400, current.pm2_env, () => {});
    assert.equal(checked, true);
    console.log(`PM2: late-exit duplication ${reproduced ? 'reproduced' : 'not present unguarded'}; stale exit, normal restart and PID reuse checks passed`);
  } finally {
    assert.equal(path.dirname(path.resolve(scratch)), path.resolve(tmpdir()));
    assert.ok(path.basename(scratch).startsWith('pm2-exit-regression-'));
    rmSync(scratch, { recursive: true, force: true });
  }
}
// God owns background timers; this isolated test process must not leave them alive.
main().then(() => process.exit(0), (error) => { console.error(error); process.exit(1); });
