"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const completionItemBuilder_1 = require("../completionItemBuilder");
const baseTemplates_1 = require("./baseTemplates");
const utils_1 = require("../utils");
class TypeTemplate extends baseTemplates_1.BaseExpressionTemplate {
    constructor(keyword) {
        super();
        this.keyword = keyword;
    }
    buildCompletionItem(code, position) {
        return completionItemBuilder_1.CompletionItemBuilder
            .create(this.keyword, code)
            .description(`type expr ${this.keyword}`)
            .replace(`type {{expr}} ${this.keyword} {\n${utils_1.getIndentCharacters()}\${0}\n}`, position, true)
            .build();
    }
}
exports.TypeTemplate = TypeTemplate;
exports.build = () => [
    new TypeTemplate('struct'),
    new TypeTemplate('interface')
];
//# sourceMappingURL=typeTemplates.js.map