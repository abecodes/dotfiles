"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const completionItemBuilder_1 = require("../completionItemBuilder");
const baseTemplates_1 = require("./baseTemplates");
class ReturnTemplate extends baseTemplates_1.BaseExpressionTemplate {
    buildCompletionItem(code, position) {
        return completionItemBuilder_1.CompletionItemBuilder
            .create('return', code)
            .description(`return expr`)
            .replace(`return \${1:{{expr}}}\${0}`, position, true)
            .build();
    }
}
exports.ReturnTemplate = ReturnTemplate;
exports.build = () => new ReturnTemplate();
//# sourceMappingURL=returnTemplate.js.map