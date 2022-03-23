"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const completionItemBuilder_1 = require("../completionItemBuilder");
const baseTemplates_1 = require("./baseTemplates");
class ErrorTemplate extends baseTemplates_1.BaseExpressionTemplate {
    buildCompletionItem(code, position) {
        return completionItemBuilder_1.CompletionItemBuilder
            .create('error', code)
            .description(`errors.New("Error Message")`)
            .replace(`errors.New(\${1:{{expr}}})`, position, true)
            .build();
    }
}
exports.ErrorTemplate = ErrorTemplate;
exports.build = () => [
    new ErrorTemplate()
];
//# sourceMappingURL=errorTemplate.js.map