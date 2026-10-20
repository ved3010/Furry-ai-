const fs = require('fs');
const content = fs.readFileSync('c:/Users/mitka/OneDrive/Desktop/AE Codes/cattu3.0/renderer/renderer.js', 'utf8');

// Find where window.electronAPI.onLanguageChanged is registered
const searchStr = 'window.electronAPI.onLanguageChanged';
const index = content.indexOf(searchStr);
if (index !== -1) {
  console.log('--- Context around window.electronAPI.onLanguageChanged ---');
  console.log(content.substring(index - 200, index + 500));
}
