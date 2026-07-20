const fs = require('fs');
const path = require('path');

const projectRoot = 'C:/Users/iweb/youtube-API-prototype';
const batchesToProcess = [7, 8, 9, 10];

function generateSummary(res) {
    if (res.path.endsWith('.ts')) {
        if (res.functions && res.functions.length > 0) {
            const names = res.functions.map(f => f.name).slice(0, 3).join(', ');
            return `TypeScript module providing functions: ${names}.`;
        }
        return 'TypeScript source file.';
    }
    if (res.path.endsWith('.xml')) return 'XML configuration or data file.';
    if (res.path.endsWith('.json')) return 'JSON data file.';
    return 'Project file.';
}

batchesToProcess.forEach(i => {
    const rawPath = path.join(projectRoot, '.understand-anything/intermediate/batch-' + i + '-raw.json');
    const inputPath = path.join(projectRoot, '.understand-anything/intermediate/batch-' + i + '-input.json');
    
    if (!fs.existsSync(rawPath)) return;
    
    const raw = JSON.parse(fs.readFileSync(rawPath, 'utf8'));
    const input = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
    const batchImportData = input.batchImportData || {};

    const nodes = [];
    const edges = [];

    raw.results.forEach(res => {
        const fileId = 'file:' + res.path;
        nodes.push({
            id: fileId,
            type: 'file',
            name: path.basename(res.path),
            filePath: res.path,
            summary: generateSummary(res),
            tags: [res.language, res.fileCategory].filter(Boolean),
            complexity: res.totalLines > 200 ? 'complex' : (res.totalLines > 50 ? 'moderate' : 'simple')
        });

        if (res.functions) {
            res.functions.forEach(fn => {
                const fnId = `function:${res.path}:${fn.name}`;
                nodes.push({
                    id: fnId,
                    type: 'function',
                    name: fn.name,
                    filePath: res.path,
                    summary: `Function ${fn.name} defined in ${res.path}`,
                    tags: ['function'],
                    complexity: (fn.endLine - fn.startLine) > 30 ? 'moderate' : 'simple'
                });
                edges.push({
                    source: fileId,
                    target: fnId,
                    type: 'contains',
                    weight: 1.0
                });
            });
        }

        if (res.classes) {
            res.classes.forEach(cls => {
                const clsId = `class:${res.path}:${cls.name}`;
                nodes.push({
                    id: clsId,
                    type: 'class',
                    name: cls.name,
                    filePath: res.path,
                    summary: `Class ${cls.name} defined in ${res.path}`,
                    tags: ['class'],
                    complexity: (cls.endLine - cls.startLine) > 100 ? 'complex' : 'moderate'
                });
                edges.push({
                    source: fileId,
                    target: clsId,
                    type: 'contains',
                    weight: 1.0
                });
            });
        }

        if (res.callGraph) {
            res.callGraph.forEach(call => {
                // If callee is internal to the same file
                const isInternal = res.functions && res.functions.some(f => f.name === call.callee);
                if (isInternal) {
                    edges.push({
                        source: `function:${res.path}:${call.caller}`,
                        target: `function:${res.path}:${call.callee}`,
                        type: 'calls',
                        weight: 0.5
                    });
                }
            });
        }

        // Imports
        const imports = batchImportData[res.path] || [];
        imports.forEach(impPath => {
            edges.push({
                source: fileId,
                target: 'file:' + impPath,
                type: 'imports',
                weight: 0.7
            });
        });
    });

    fs.writeFileSync(path.join(projectRoot, '.understand-anything/intermediate/batch-' + i + '.json'), JSON.stringify({ nodes, edges }, null, 2));
    console.log('Processed batch-' + i + '.json');
});
