// Jest transform for node_modules/@nestjs/*: Nest 12 ships ESM only, and Jest 30 can only
// require() ESM on Node 24.9+. The app itself runs fine on Node 22 (Node's own require(esm)),
// so only the tests need this: compile the packages to CommonJS with TypeScript.
// `import.meta` can't be compiled to CommonJS, so replace its two uses first.
const ts = require('typescript');

module.exports = {
    process(source_text) {
        const source = source_text
            // @nestjs/typeorm: CommonJS already has `require`
            .replace(/^const require = createRequire\(import\.meta\.url\);$/m, '')
            .replace(/import\.meta\.url/g, "require('url').pathToFileURL(__filename).href");
        const { outputText } = ts.transpileModule(source, {
            compilerOptions: {
                module: ts.ModuleKind.CommonJS,
                target: ts.ScriptTarget.ES2022,
                esModuleInterop: true,
                allowJs: true
            }
        });
        return { code: outputText };
    }
};
