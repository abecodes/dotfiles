"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const completionItemBuilder_1 = require("../completionItemBuilder");
const baseTemplates_1 = require("./baseTemplates");
class LenTemplate extends baseTemplates_1.BaseExpressionTemplate {
    buildCompletionItem(code, position) {
        const dotIdx = code.lastIndexOf('.', position.character);
        const codeBeforeDot = code.substr(0, dotIdx);
        let lastComponent = getLastComponent(codeBeforeDot);
        let builder = completionItemBuilder_1.CompletionItemBuilder
            .create('len', lastComponent)
            .description(`len(expr)`);
        builder.insertText('len(' + lastComponent + ')');
        builder.deleteTextBeforeCursor(position, lastComponent.length + 1);
        return builder.build();
    }
}
exports.LenTemplate = LenTemplate;
exports.build = () => new LenTemplate();
function getLastComponent(input) {
    if (input.length === 0) {
        return '';
    }
    let lastComponent = '';
    for (let i = 0; i < input.length; i++) {
        let character = input.substr(input.length - i - 1, 1);
        if (!character.match(/[a-zA-Z0-9\(\)\[\]\.]/)) {
            return lastComponent;
        }
        lastComponent = character + lastComponent;
    }
    return lastComponent;
}
//# sourceMappingURL=lenTemplate.js.map