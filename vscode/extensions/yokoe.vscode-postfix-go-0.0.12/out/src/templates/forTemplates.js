"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const completionItemBuilder_1 = require("../completionItemBuilder");
const baseTemplates_1 = require("./baseTemplates");
class BaseForTemplate extends baseTemplates_1.BaseTemplate {
    canUse(code) {
        return true;
    }
}
class ForrTemplate extends BaseForTemplate {
    buildCompletionItem(code, position) {
        return completionItemBuilder_1.CompletionItemBuilder
            .create('forr', code)
            .description('for index := range objects')
            .replace(`for \${1:index} := range \${3:{{expr}}} {\n\${0}\n}`, position, true)
            .build();
    }
}
exports.ForrTemplate = ForrTemplate;
class ForTemplate extends BaseForTemplate {
    buildCompletionItem(code, position) {
        return completionItemBuilder_1.CompletionItemBuilder
            .create('for', code)
            .description('for index, element := range objects')
            .replace(`for \${1:index}, \${2:element} := range \${3:{{expr}}} {\n\${0}\n}`, position, true)
            .build();
    }
}
exports.ForTemplate = ForTemplate;
exports.build = () => [
    new ForTemplate(),
    new ForrTemplate()
];
//# sourceMappingURL=forTemplates.js.map