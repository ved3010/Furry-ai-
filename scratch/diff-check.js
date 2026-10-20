const fs = require('fs');
const path = require('path');

const files = ['main.js', 'preload.js', 'renderer/renderer.js', 'renderer/styles.css', 'renderer/index.html'];
for (const file of files) {
  const rootPath = path.join(__dirname, '..', file);
  const extPath = path.join(__dirname, '..', 'comnyang_extracted', 'resources', 'app', file);
  if (!fs.existsSync(extPath)) {
    console.log(`File only in root: ${file}`);
    continue;
  }
  const rootContent = fs.readFileSync(rootPath, 'utf8');
  const extContent = fs.readFileSync(extPath, 'utf8');
  if (rootContent === extContent) {
    console.log(`Identical: ${file}`);
  } else {
    console.log(`DIFFERENT: ${file} (sizes: root=${rootContent.length}, ext=${extContent.length})`);
  }
}
