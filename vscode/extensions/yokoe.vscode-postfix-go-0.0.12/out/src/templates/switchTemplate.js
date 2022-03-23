"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const completionItemBuilder_1 = require("../completionItemBuilder");
const baseTemplates_1 = require("./baseTemplates");
class SwitchTemplate extends baseTemplates_1.BaseTemplate {
    buildCompletionItem(code, position) {
        return completionItemBuilder_1.CompletionItemBuilder
            .create('switch', code)
            .description('switch statemeent (Go)')
            .replace(`switch \${1:{{expr}}} {\ncase \${2:condition}: \n\${0}\n}`, position, true)
            .build();
    }
    canUse(code) {
        return true;
    }
}
exports.SwitchTemplate = SwitchTemplate;
exports.build = () => [
    new SwitchTemplate()
];
//# sourceMappingURL=switchTemplate.js.map