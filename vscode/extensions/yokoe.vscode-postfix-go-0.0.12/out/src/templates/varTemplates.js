"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const completionItemBuilder_1 = require("../completionItemBuilder");
const baseTemplates_1 = require("./baseTemplates");
class VarTemplate extends baseTemplates_1.BaseExpressionTemplate {
    constructor() {
        super();
    }
    buildCompletionItem(code, position) {
        return completionItemBuilder_1.CompletionItemBuilder
            .create("var", code)
            .description(`name := expr`)
            .replace('${1:name} := {{expr}}$0', position, true)
            .build();
    }
}
exports.VarTemplate = VarTemplate;
class ConstTemplate extends baseTemplates_1.BaseExpressionTemplate {
    constructor() {
        super();
    }
    buildCompletionItem(code, position) {
        return completionItemBuilder_1.CompletionItemBuilder
            .create("const", code)
            .description(`const name type = expr`)
            .replace('const ${1:name} ${2:Type} = {{expr}}$0', position, true)
            .build();
    }
}
exports.ConstTemplate = ConstTemplate;
exports.build = () => [
    new VarTemplate(),
    new ConstTemplate()
];
//# sourceMappingURL=varTemplates.js.map