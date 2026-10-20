const fs = require('fs');
try {
  const content = fs.readFileSync('c:/Users/mitka/OneDrive/Desktop/AE Codes/cattu3.0/out.txt', 'utf16le');
  console.log('--- out.txt (UTF-16LE) ---');
  console.log(content);
} catch (e) {
  console.error(e);
}
try {
  const content2 = fs.readFileSync('c:/Users/mitka/OneDrive/Desktop/AE Codes/cattu3.0/out.txt', 'utf8');
  console.log('--- out.txt (UTF-8) ---');
  console.log(content2);
} catch (e) {}
