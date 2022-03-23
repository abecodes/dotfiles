"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vsc = require("vscode");
exports.getIndentCharacters = () => {
    if (vsc.window.activeTextEditor.options.insertSpaces) {
        return ' '.repeat(vsc.window.activeTextEditor.options.tabSize);
    }
    else {
        return '\t';
    }
};
//# sourceMappingURL=utils.js.map