const fs = require('fs');
const content = fs.readFileSync('renderer/renderer.js', 'utf8');
console.log('Index of voiceMicButton:', content.indexOf('voiceMicButton'));
