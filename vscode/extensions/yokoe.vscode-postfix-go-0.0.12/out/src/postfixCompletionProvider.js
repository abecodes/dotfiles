"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vsc = require("vscode");
const glob = require("glob");
const customTemplate_1 = require("./templates/customTemplate");
let currentSuggestion = undefined;
class PostfixCompletionProvider {
    constructor() {
        this.templates = [];
        this.loadCustomTemplates = () => {
            const config = vsc.workspace.getConfiguration('postfixGo');
            const templates = config.get('customTemplates');
            if (templates) {
                this.templates.push(...templates.map(t => new customTemplate_1.CustomTemplate(t.name, t.description, t.body, t.when)));
            }
        };
        this.loadBuiltinTemplates = () => {
            let files = glob.sync('./templates/*.js', { cwd: __dirname });
            files.forEach(path => {
                let builder = require(path).build;
                if (builder) {
                    let tpls = builder();
                    if (Array.isArray(tpls)) {
                        this.templates.push(...tpls);
                    }
                    else {
                        this.templates.push(tpls);
                    }
                }
            });
        };
        this.loadBuiltinTemplates();
        this.loadCustomTemplates();
    }
    provideCompletionItems(document, position, token) {
        let line = document.lineAt(position.line);
        let dotIdx = line.text.lastIndexOf('.', position.character);
        if (dotIdx === -1) {
            return [];
        }
        let code = line.text.substr(line.firstNonWhitespaceCharacterIndex);
        const commentIndex = line.text.indexOf('//');
        if (commentIndex >= 0 && position.character > commentIndex) {
            return [];
        }
        return this.templates
            .filter(t => t.canUse(code))
            .map(t => t.buildCompletionItem(code, position, line.text.substring(dotIdx + 1, position.character)));
    }
    resolveCompletionItem(item, token) {
        currentSuggestion = item.label;
        return item;
    }
}
exports.PostfixCompletionProvider = PostfixCompletionProvider;
exports.getCurrentSuggestion = () => currentSuggestion;
//# sourceMappingURL=postfixCompletionProvider.js.map