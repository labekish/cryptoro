import fs from 'node:fs';
import path from 'node:path';

const adminIndexPath = path.join(process.cwd(), 'admin', 'index.html');
const cssHref = '/admin/custom.css';
const cssTag = `<link rel="stylesheet" href="${cssHref}">`;

if (!fs.existsSync(adminIndexPath)) {
  console.log('[patch-tina-admin] admin/index.html not found, skip.');
  process.exit(0);
}

let html = fs.readFileSync(adminIndexPath, 'utf8');

if (!html.includes(cssHref)) {
  if (html.includes('</head>')) {
    html = html.replace('</head>', `  ${cssTag}\n</head>`);
    fs.writeFileSync(adminIndexPath, html, 'utf8');
    console.log('[patch-tina-admin] Injected /admin/custom.css into admin/index.html');
  } else {
    console.log('[patch-tina-admin] </head> not found, skip.');
  }
} else {
  console.log('[patch-tina-admin] /admin/custom.css already linked.');
}
