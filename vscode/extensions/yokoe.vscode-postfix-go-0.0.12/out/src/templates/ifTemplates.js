"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const completionItemBuilder_1 = require("../completionItemBuilder");
const baseTemplates_1 = require("./baseTemplates");
const utils_1 = require("../utils");
class IfTemplate extends baseTemplates_1.BaseExpressionTemplate {
    buildCompletionItem(code, position) {
        return completionItemBuilder_1.CompletionItemBuilder
            .create('if', code)
            .description(`if expr`)
            .replace(`if {{expr}} {\n${utils_1.getIndentCharacters()}\${0}\n}`, position, true)
            .build();
    }
}
exports.IfTemplate = IfTemplate;
class ElseTemplate extends baseTemplates_1.BaseExpressionTemplate {
    buildCompletionItem(code, position) {
        let replacement = '{{expr}}';
        return completionItemBuilder_1.CompletionItemBuilder
            .create('else', code)
            .description(`if (!expr)`)
            .replace(`if !${replacement} {\n${utils_1.getIndentCharacters()}\${0}\n}`, position, true)
            .build();
    }
}
exports.ElseTemplate = ElseTemplate;
class IfEqualityTemplate extends baseTemplates_1.BaseExpressionTemplate {
    constructor(keyword, operator, operand) {
        super();
        this.keyword = keyword;
        this.operator = operator;
        this.operand = operand;
    }
    buildCompletionItem(code, position) {
        return completionItemBuilder_1.CompletionItemBuilder
            .create(this.keyword, code)
            .description(`if expr ${this.operator} ${this.operand}`)
            .replace(`if {{expr}} ${this.operator} ${this.operand} {\n${utils_1.getIndentCharacters()}\${0}\n}`, position, true)
            .build();
    }
}
exports.IfEqualityTemplate = IfEqualityTemplate;
exports.build = () => [
    new IfTemplate(),
    new ElseTemplate(),
    new IfEqualityTemplate('nil', '==', 'nil'),
    new IfEqualityTemplate('notnil', '!=', 'nil')
];
//# sourceMappingURL=ifTemplates.js.map