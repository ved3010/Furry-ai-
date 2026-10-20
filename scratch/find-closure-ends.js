const fs = require('fs');
const content = fs.readFileSync('c:/Users/mitka/OneDrive/Desktop/AE Codes/cattu3.0/renderer/renderer.js', 'utf8');

// Find the string 'window.voiceAPI.onPlaySong'
const playSongIndex = content.indexOf('window.voiceAPI.onPlaySong');
if (playSongIndex !== -1) {
  console.log('--- Context before window.voiceAPI.onPlaySong ---');
  console.log(content.substring(playSongIndex - 300, playSongIndex));
  console.log('--- Context after/around window.voiceAPI.onPlaySong ---');
  console.log(content.substring(playSongIndex, playSongIndex + 1000));
}
