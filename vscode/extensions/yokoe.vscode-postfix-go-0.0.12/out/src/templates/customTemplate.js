"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const baseTemplates_1 = require("./baseTemplates");
const completionItemBuilder_1 = require("../completionItemBuilder");
class CustomTemplate extends baseTemplates_1.BaseTemplate {
    constructor(name, description, body, conditions) {
        super();
        this.name = name;
        this.description = description;
        this.body = body;
        this.conditions = conditions;
    }
    buildCompletionItem(code, position, suffix) {
        return completionItemBuilder_1.CompletionItemBuilder
            .create(this.name, code + suffix)
            .description(this.description)
            .replace(this.body, position, true)
            .build();
    }
    canUse(code) {
        return true;
    }
}
exports.CustomTemplate = CustomTemplate;
//# sourceMappingURL=customTemplate.js.map