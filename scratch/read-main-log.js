const fs = require('fs');
const path = require('path');
const logPath = 'C:/Users/mitka/AppData/Roaming/Comnyang Dev/logs/main.log';
try {
  if (fs.existsSync(logPath)) {
    const lines = fs.readFileSync(logPath, 'utf8').split('\n');
    console.log('--- main.log (last 30 lines) ---');
    console.log(lines.slice(-30).join('\n'));
  } else {
    console.log('Log file does not exist at:', logPath);
  }
} catch (e) {
  console.error(e);
}
