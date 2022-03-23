"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vsc = require("vscode");
const COMPLETION_ITEM_TITLE = 'Postfix templates';
class CompletionItemBuilder {
    constructor(keyword, code) {
        this.keyword = keyword;
        this.code = code;
        this.command = (command) => {
            this.item.command = command;
            return this;
        };
        this.insertText = (insertText) => {
            this.item.insertText = insertText;
            return this;
        };
        this.deleteTextBeforeCursor = (position, length) => {
            this.item.additionalTextEdits = [
                vsc.TextEdit.delete(new vsc.Range(position.translate(0, -length), position))
            ];
            return this;
        };
        this.replace = (replacement, position, useSnippets) => {
            const dotIdx = this.code.lastIndexOf('.');
            const codeBeforeTheDot = this.code.substr(0, dotIdx);
            if (useSnippets) {
                const escapedCode = codeBeforeTheDot.replace('$', '\\$');
                this.item.insertText = new vsc.SnippetString(replacement.replace(new RegExp('{{expr}}', 'g'), escapedCode));
            }
            else {
                this.item.insertText = replacement.replace(new RegExp('{{expr}}', 'g'), codeBeforeTheDot);
            }
            this.item.additionalTextEdits = [
                vsc.TextEdit.delete(new vsc.Range(position.translate(0, -codeBeforeTheDot.length - 1), position))
            ];
            return this;
        };
        this.description = (description) => {
            this.item.documentation = description;
            return this;
        };
        this.build = () => this.item;
        this.item = new vsc.CompletionItem(keyword, vsc.CompletionItemKind.Snippet);
        this.item.detail = COMPLETION_ITEM_TITLE;
    }
}
CompletionItemBuilder.create = (keyword, code) => new CompletionItemBuilder(keyword, code);
exports.CompletionItemBuilder = CompletionItemBuilder;
//# sourceMappingURL=completionItemBuilder.js.map