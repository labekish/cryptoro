import fs from 'fs';

for (const file of ['index.html', 'catalog.html']) {
    let content = fs.readFileSync(file, 'utf8');
    content = content.replace(/<header[\s\S]*?<\/header>/ig, '');
    content = content.replace(/<footer[\s\S]*?<\/footer>/ig, '');
    fs.writeFileSync(file, content, 'utf8');
}
console.log('Stripped headers and footers');
