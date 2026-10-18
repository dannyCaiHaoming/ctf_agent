import { readFileSync } from 'node:fs';
const input = readFileSync('payload.txt', 'utf8').trim();
// Preserve this script and repair the local syntax error after observing stderr.
console.log(Buffer.from(input, 'base64').toString('utf8');
