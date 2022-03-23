"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const completionItemBuilder_1 = require("../completionItemBuilder");
const baseTemplates_1 = require("./baseTemplates");
class PrintTemplate extends baseTemplates_1.BaseExpressionTemplate {
    buildCompletionItem(code, position) {
        return completionItemBuilder_1.CompletionItemBuilder
            .create('print', code)
            .description(`fmt.Println(expr)`)
            .replace(`fmt.Println(\${0:{{expr}}})`, position, true)
            .build();
    }
}
exports.PrintTemplate = PrintTemplate;
class PrintfTemplate extends baseTemplates_1.BaseExpressionTemplate {
    buildCompletionItem(code, position) {
        return completionItemBuilder_1.CompletionItemBuilder
            .create('printf', code)
            .description(`fmt.Printf("%+v'\\n", expr)`)
            .replace(`fmt.Printf("%+v\\n", \${0:{{expr}}})`, position, true)
            .build();
    }
}
exports.PrintfTemplate = PrintfTemplate;
exports.build = () => [
    new PrintTemplate(),
    new PrintfTemplate()
];
//# sourceMappingURL=printTemplate.js.map