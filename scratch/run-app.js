const { execFile } = require('child_process');
const path = require('path');

const exePath = path.join(__dirname, '..', 'comnyang_extracted', 'Comnyang Dev.exe');
console.log('Spawning Comnyang Dev and keeping it alive:', exePath);

const child = execFile(exePath, ['--remote-debugging-port=9222'], (error, stdout, stderr) => {
  console.log('Comnyang Dev exited.');
  if (error) {
    console.error('Error:', error);
  }
  console.log('Stdout:', stdout);
  console.log('Stderr:', stderr);
});

child.on('spawn', () => {
  console.log('Process spawned successfully! PID:', child.pid);
});

child.on('exit', (code, signal) => {
  console.log(`Process exited with code ${code} and signal ${signal}`);
  process.exit(code || 0);
});

// Keep this parent process alive for 30 minutes
setTimeout(() => {
  console.log('Timeout. Killing child...');
  child.kill();
}, 30 * 60 * 1000);
