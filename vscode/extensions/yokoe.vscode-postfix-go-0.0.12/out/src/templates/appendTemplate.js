"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const completionItemBuilder_1 = require("../completionItemBuilder");
const baseTemplates_1 = require("./baseTemplates");
class AppendTemplate extends baseTemplates_1.BaseExpressionTemplate {
    buildCompletionItem(code, position) {
        return completionItemBuilder_1.CompletionItemBuilder
            .create('append', code)
            .description(`expr = append(expr, ...)`)
            .replace(`{{expr}} = append({{expr}}, \${0:element})`, position, true)
            .build();
    }
}
exports.AppendTemplate = AppendTemplate;
exports.build = () => new AppendTemplate();
//# sourceMappingURL=appendTemplate.js.map