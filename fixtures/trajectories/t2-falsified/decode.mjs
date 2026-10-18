import { readFileSync } from 'node:fs';
console.log(Buffer.from(readFileSync('payload.txt', 'utf8').trim(), 'base64').toString('utf8'));
