import fs from 'fs';
import path from 'path';

const inputFile = 'C:\\Users\\iweb\\youtube-API-prototype\\4_publishing_ddex_dsr.txt';
const outputFile = 'C:\\Users\\iweb\\youtube-API-prototype\\4_publishing_ddex_dsr.csv';

function convertTsvToCsv(input, output) {
    if (!fs.existsSync(input)) {
        console.error(`Input file not found: ${input}`);
        return;
    }

    const data = fs.readFileSync(input, 'utf8');
    const lines = data.split(/\r?\n/);
    const csvLines = lines.map(line => {
        if (!line.trim()) return '';
        // Split by tab
        const cells = line.split('\t');
        // Wrap each cell in quotes if it contains a comma or quote
        const quotedCells = cells.map(cell => {
            let escaped = cell.replace(/"/g, '""');
            if (escaped.includes(',') || escaped.includes('"') || escaped.includes('\n')) {
                return `"${escaped}"`;
            }
            return escaped;
        });
        return quotedCells.join(',');
    });
    fs.writeFileSync(output, csvLines.join('\n'));
    console.log(`Successfully converted ${input} to ${output}`);
}

convertTsvToCsv(inputFile, outputFile);
