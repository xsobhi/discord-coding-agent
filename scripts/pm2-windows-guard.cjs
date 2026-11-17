// Applied only inside this bot's own embedded Windows PM2 runtime.
// PM2 7.0.1 looks up the *current* process by app ID when an old child exits, so a delayed exit
// after a restart marks the replacement stopped and spawns another copy. Ignore exits from non-current children.
// Fails safe: if the installed PM2 lacks the internals patched here, nothing is changed.
module.exports = function guardRuntime(God) {
  if (God.exitGuardInstalled) return true;
  if (typeof God.handleExit !== 'function' || typeof God.killProcess !== 'function' || !God.clusters_db) {
    console.warn('PM2 exit guard not installed: this PM2 version lacks handleExit/killProcess/clusters_db');
    return false;
  }
  God.exitGuardInstalled = true;
  const handleExit = God.handleExit;
  God.handleExit = function (child, ...args) {
    if (this.clusters_db[child.pm2_env.pm_id] !== child) return false;
    return handleExit.call(this, child, ...args);
  };
  const killProcess = God.killProcess;
  God.killProcess = function (pid, env, ...args) {
    // An earlier tree-kill snapshot is not evidence that this new child exited.
    if (env) delete env._tree_pids;
    return killProcess.call(this, pid, env, ...args);
  };
  return true;
};
