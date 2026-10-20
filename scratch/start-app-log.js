const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const exePath = path.join(__dirname, '..', 'comnyang_extracted', 'Comnyang Dev.exe');
console.log('Spawning detached process with log redirect:', exePath);

const out = fs.openSync(path.join(__dirname, '..', 'out-spawn.txt'), 'w');
const err = fs.openSync(path.join(__dirname, '..', 'err-spawn.txt'), 'w');

const child = spawn(exePath, ['--remote-debugging-port=9222'], {
  detached: true,
  stdio: ['ignore', out, err]
});

child.unref();
console.log('Spawned! PID:', child.pid);
setTimeout(() => {
  console.log('Done.');
  process.exit(0);
}, 2000);
