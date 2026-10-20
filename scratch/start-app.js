const { spawn } = require('child_process');
const path = require('path');

const exePath = path.join(__dirname, '..', 'comnyang_extracted', 'Comnyang Dev.exe');
console.log('Spawning detached process:', exePath);

const child = spawn(exePath, ['--remote-debugging-port=9222'], {
  detached: true,
  stdio: 'ignore'
});

child.unref();
console.log('Detached process spawned. PID:', child.pid);
process.exit(0);
